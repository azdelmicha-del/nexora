const mongoose = require('mongoose');
const { getRDDate } = require('./utils/timezone');

let isConnected = false;

function normalizeId(id) {
    if (id === null || id === undefined) return null;
    if (typeof id === 'number') return id;
    if (typeof id === 'string' && /^\d+$/.test(id)) return parseInt(id, 10);
    try {
        if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
    } catch (e) {}
    return id;
}

async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI no configurada en variables de entorno');
    }

    await mongoose.connect(uri, {
        dbName: 'nexora_pos',
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log('✅ MongoDB conectado (db: nexora_pos)');
    return mongoose.connection;
}

async function disconnectDB() {
    if (isConnected) {
        await mongoose.disconnect();
        isConnected = false;
        console.log('MongoDB desconectado');
    }
}

function getDb() {
    return mongoose.connection;
}

// Helper para convertir ObjectId de MongoDB a numero (para compatibilidad con frontend)
function toPlainId(doc) {
    if (!doc) return null;
    const obj = doc.toObject ? doc.toObject() : { ...doc };
    if (obj._id !== undefined) {
        obj.id = typeof obj._id === 'object' ? obj._id.toString() : obj._id;
        delete obj._id;
    }
    return obj;
}

function toPlainArray(docs) {
    return docs.map(toPlainId).filter(Boolean);
}

// ── Funciones de licencia ─────────────────────────────────────────────────

async function getLicenciaNegocio(negocioId) {
    try {
        const db = getDb();
        const normalizedId = normalizeId(negocioId);
        const negocio = await db.collection('negocios').findOne(
            { _id: normalizedId },
            { projection: { licencia_plan: 1, licencia_fecha_inicio: 1, licencia_fecha_expiracion: 1, licencia_hardware_id: 1 } }
        );
        if (!negocio) return null;
        return {
            plan: negocio.licencia_plan,
            fechaInicio: negocio.licencia_fecha_inicio,
            fechaExpiracion: negocio.licencia_fecha_expiracion,
            hardwareId: negocio.licencia_hardware_id
        };
    } catch (error) {
        console.error('Error getLicenciaNegocio:', error);
        return null;
    }
}

async function iniciarTrialNegocio(negocioId) {
    try {
        const licencia = await getLicenciaNegocio(negocioId);
        if (licencia && licencia.fechaInicio) {
            return licencia.fechaInicio;
        }
        const fechaInicio = getRDDate().toISOString();
        const db = getDb();
        await db.collection('negocios').updateOne(
            { _id: normalizeId(negocioId) },
            { $set: { licencia_fecha_inicio: fechaInicio } }
        );
        return fechaInicio;
    } catch (error) {
        console.error('Error iniciarTrialNegocio:', error);
        return null;
    }
}

async function activarLicenciaNegocio(negocioId, plan, dias, hardwareId) {
    try {
        const fechaInicio = getRDDate();
        const fechaExpiracion = new Date(fechaInicio);
        fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

        const db = getDb();
        await db.collection('negocios').updateOne(
            { _id: normalizeId(negocioId) },
            {
                $set: {
                    licencia_plan: plan,
                    licencia_fecha_inicio: fechaInicio.toISOString(),
                    licencia_fecha_expiracion: fechaExpiracion.toISOString(),
                    licencia_hardware_id: hardwareId
                }
            }
        );

        return {
            plan,
            fechaInicio: fechaInicio.toISOString(),
            fechaExpiracion: fechaExpiracion.toISOString()
        };
    } catch (error) {
        console.error('Error activarLicenciaNegocio:', error);
        return null;
    }
}

async function getDiasLicenciaNegocio(negocioId) {
    const licencia = await getLicenciaNegocio(negocioId);
    if (!licencia) return { valid: true, type: 'trial', daysRemaining: 7 };

    if (licencia.plan && licencia.plan !== 'trial') {
        if (licencia.fechaExpiracion) {
            const expDate = new Date(licencia.fechaExpiracion);
            const now = getRDDate();
            const daysRemaining = Math.floor((expDate - now) / (1000 * 60 * 60 * 24));
            return {
                valid: daysRemaining > 0,
                type: licencia.plan,
                daysRemaining: Math.max(0, daysRemaining),
                licenciaPlan: licencia.plan,
                licenciaFechaInicio: licencia.fechaInicio,
                licenciaFechaExpiracion: licencia.fechaExpiracion
            };
        }
        return {
            valid: true,
            type: licencia.plan,
            daysRemaining: 999,
            licenciaPlan: licencia.plan,
            licenciaFechaInicio: licencia.fechaInicio,
            licenciaFechaExpiracion: null
        };
    }

    if (licencia.fechaInicio) {
        const TRIAL_DAYS = 7;
        const startDate = new Date(licencia.fechaInicio);
        const now = getRDDate();
        const daysUsed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = TRIAL_DAYS - daysUsed;
        return {
            valid: daysRemaining > 0,
            type: 'trial',
            daysRemaining: Math.max(0, daysRemaining),
            licenciaPlan: 'trial',
            licenciaFechaInicio: licencia.fechaInicio,
            licenciaFechaExpiracion: null
        };
    }

    return { valid: true, type: 'trial', daysRemaining: 7 };
}

// ── NCF ───────────────────────────────────────────────────────────────────

async function getNextNCF(negocioId, tipoComprobante) {
    try {
        const db = getDb();
        const prefijos = { '31': 'E31', '32': 'E32', '33': 'E33', '34': 'E34' };
        const prefijo = prefijos[tipoComprobante] || 'E31';

        const existente = await db.collection('secuencias_ncf').findOne(
            { negocio_id: negocioId, tipo_comprobante: tipoComprobante }
        );

        if (existente) {
            const nuevaSecuencia = existente.secuencia_actual + 1;
            await db.collection('secuencias_ncf').updateOne(
                { _id: existente._id },
                { $set: { secuencia_actual: nuevaSecuencia, fecha_ultima_emision: getRDDate().toISOString() } }
            );
            return `${prefijo}${String(nuevaSecuencia).padStart(10, '0')}`;
        }

        await db.collection('secuencias_ncf').insertOne({
            negocio_id: negocioId,
            tipo_comprobante: tipoComprobante,
            prefijo,
            secuencia_actual: 1,
            fecha_ultima_emision: getRDDate().toISOString(),
            estado: 'activo'
        });

        return `${prefijo}0000000001`;
    } catch (error) {
        console.error('Error getNextNCF:', error);
        return `E31${String(Date.now()).slice(-10)}`;
    }
}

// ── Limpieza de ventas antiguas ──────────────────────────────────────────

async function limpiarVentasAntiguas() {
    try {
        const hace30Dias = getRDDate();
        hace30Dias.setDate(hace30Dias.getDate() - 30);
        const fechaLimite = hace30Dias.toISOString();

        const db = getDb();
        const ventasAntiguas = await db.collection('ventas').find(
            { fecha: { $lt: fechaLimite } },
            { projection: { _id: 1 } }
        ).toArray();

        if (ventasAntiguas.length > 0) {
            const idsAntiguos = ventasAntiguas.map(v => v._id);
            await db.collection('venta_detalles').deleteMany({ venta_id: { $in: idsAntiguos } });
            await db.collection('ventas').deleteMany({ fecha: { $lt: fechaLimite } });
            console.log(`Limpiadas ${ventasAntiguas.length} ventas antiguas (>30 dias)`);
        }
    } catch (error) {
        console.error('Error limpiando ventas antiguas:', error);
    }
}

// ── Storage paths (compatibilidad, ya no se usa en MongoDB) ──────────────

function getStoragePaths() {
    return {
        dbDir: process.env.DB_DIR || './server/db',
        dbPath: 'mongodb',
        backupDir: process.env.BACKUP_DIR || './backups'
    };
}

// ── Init database (MongoDB no necesita schema, solo conexion) ────────────

async function initDatabase() {
    console.log('Inicializando MongoDB...');
    const conn = await connectDB();

    // Crear indexes si no existen
    const collections = [
        { name: 'usuarios', indexes: [{ key: { negocio_id: 1 } }, { key: { email: 1 }, unique: true }] },
        { name: 'servicios', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'categorias', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'clientes', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'ventas', indexes: [{ key: { negocio_id: 1 } }, { key: { fecha: -1 } }] },
        { name: 'venta_detalles', indexes: [{ key: { venta_id: 1 } }] },
        { name: 'citas', indexes: [{ key: { negocio_id: 1 } }, { key: { fecha: 1 } }] },
        { name: 'notificaciones', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'productos', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'movimientos_inventario', indexes: [{ key: { negocio_id: 1 } }, { key: { producto_id: 1 } }] },
        { name: 'comisiones', indexes: [{ key: { negocio_id: 1 } }, { key: { user_id: 1 } }] },
        { name: 'pedidos', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'pedidos_items', indexes: [{ key: { pedido_id: 1 } }] },
        { name: 'secuencias_ncf', indexes: [{ key: { negocio_id: 1, tipo_comprobante: 1 }, unique: true }] },
        { name: 'puntos_lealtad', indexes: [{ key: { negocio_id: 1, cliente_id: 1 }, unique: true }] },
        { name: 'menu_categorias', indexes: [{ key: { negocio_id: 1 } }] },
        { name: 'menu_items', indexes: [{ key: { negocio_id: 1 } }, { key: { categoria_id: 1 } }] },
        { name: 'log_auditoria', indexes: [{ key: { negocio_id: 1 } }, { key: { fecha: -1 } }] },
        { name: 'estado_resultado_items', indexes: [{ key: { negocio_id: 1 } }, { key: { fecha: -1 } }] },
    ];

    for (const col of collections) {
        try {
            const collection = conn.collection(col.name);
            for (const idx of col.indexes) {
                await collection.createIndex(idx.key, { unique: idx.unique || false });
            }
        } catch (e) {
            // Index ya existe
        }
    }

    // Crear platform_config si no existe
    try {
        const pc = await conn.collection('platform_config').findOne({ _id: 1 });
        if (!pc) {
            await conn.collection('platform_config').insertOne({
                _id: 1,
                system_name: 'Nexora',
                version: '1.0.0',
                edition: 'Pro',
                copyright_year: new Date().getFullYear(),
                show_footer: 1,
                custom_text: ''
            });
        }
    } catch (e) {
        console.error('Error init platform_config:', e.message);
    }

    await limpiarVentasAntiguas();
    console.log('✅ MongoDB inicializado');
    return conn;
}

// ── Backup/restore (no aplica a MongoDB, pero mantener compatibilidad) ───

function replaceActiveDbWithBackup() {
    console.log('⚠️  replaceActiveDbWithBackup no aplica en MongoDB');
    return false;
}

function restoreLatestBackupWithBusiness() {
    console.log('⚠️  restoreLatestBackupWithBusiness no aplica en MongoDB');
    return false;
}

module.exports = {
    getDb,
    connectDB,
    disconnectDB,
    initDatabase,
    getStoragePaths,
    replaceActiveDbWithBackup,
    restoreLatestBackupWithBusiness,
    limpiarVentasAntiguas,
    getLicenciaNegocio,
    iniciarTrialNegocio,
    activarLicenciaNegocio,
    getDiasLicenciaNegocio,
    getNextNCF,
    toPlainId,
    toPlainArray,
    normalizeId
};
