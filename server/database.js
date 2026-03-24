const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// En Render, usar ruta del disco persistente
// El disco debe montarse en /opt/render/project/data
const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
const dbPath = path.join(dbDir, 'nexora.db');

// Schema SIEMPRE está en el código fuente, no en el disco
const schemaPath = path.join(__dirname, 'db', 'schema.sql');

let db;

function initDatabase() {
    console.log('DB_DIR:', dbDir);
    console.log('DB_PATH:', dbPath);
    console.log('SCHEMA_PATH:', schemaPath);
    
    // Crear directorio de BD si no existe
    if (!fs.existsSync(dbDir)) {
        console.log('Creando directorio:', dbDir);
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    if (!fs.existsSync(schemaPath)) {
        console.error('ERROR: schema.sql no encontrado en:', schemaPath);
        throw new Error('schema.sql no encontrado');
    }
    
    console.log('Inicializando base de datos...');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    
    const schema = fs.readFileSync(schemaPath, 'utf8');
    console.log('Ejecutando schema...');
    db.exec(schema);
    console.log('Schema ejecutado correctamente');
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS cajas_cerradas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            negocio_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            total REAL NOT NULL,
            cantidad_ventas INTEGER NOT NULL,
            efectivo REAL DEFAULT 0,
            transferencia REAL DEFAULT 0,
            tarjeta REAL DEFAULT 0,
            user_id INTEGER NOT NULL,
            notas TEXT,
            fecha_cierre TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (negocio_id) REFERENCES negocios(id),
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        );
    `);
    
    const columns = db.prepare("PRAGMA table_info(ventas)").all();
    const hasFueraCuadre = columns.some(c => c.name === 'fuera_cuadre');
    if (!hasFueraCuadre) {
        db.exec('ALTER TABLE ventas ADD COLUMN fuera_cuadre INTEGER DEFAULT 0');
    }
    
    const userColumns = db.prepare("PRAGMA table_info(usuarios)").all();
    const hasHorarioTipo = userColumns.some(c => c.name === 'horario_tipo');
    if (!hasHorarioTipo) {
        db.exec('ALTER TABLE usuarios ADD COLUMN horario_tipo TEXT DEFAULT "completo"');
        db.exec('ALTER TABLE usuarios ADD COLUMN hora_entrada TEXT DEFAULT "08:00"');
        db.exec('ALTER TABLE usuarios ADD COLUMN hora_salida TEXT DEFAULT "18:00"');
    }
    
    const hasLastLogin = userColumns.some(c => c.name === 'last_login');
    if (!hasLastLogin) {
        db.exec('ALTER TABLE usuarios ADD COLUMN last_login TEXT');
    }
    
    const negocioColumns = db.prepare("PRAGMA table_info(negocios)").all();
    const hasLicenciaPlan = negocioColumns.some(c => c.name === 'licencia_plan');
    if (!hasLicenciaPlan) {
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_plan TEXT DEFAULT "trial"');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_fecha_inicio TEXT');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_fecha_expiracion TEXT');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_hardware_id TEXT');
    }
    
    const negociosSinFechaInicio = db.prepare(`
        SELECT id FROM negocios 
        WHERE licencia_fecha_inicio IS NULL
    `).all();
    
    if (negociosSinFechaInicio.length > 0) {
        console.log(`Actualizando ${negociosSinFechaInicio.length} negocios sin fecha de inicio de trial`);
        const fechaAhora = new Date().toISOString();
        negociosSinFechaInicio.forEach(n => {
            db.prepare('UPDATE negocios SET licencia_fecha_inicio = ? WHERE id = ?')
                .run(fechaAhora, n.id);
        });
    }
    
    limpiarVentasAntiguas();
    
    console.log('Base de datos inicializada');
    return db;
}

function limpiarVentasAntiguas() {
    try {
        const hace30Dias = new Date();
        hace30Dias.setDate(hace30Dias.getDate() - 30);
        const fechaLimite = hace30Dias.toISOString().split('T')[0];
        
        const ventasAntiguas = db.prepare(`
            SELECT id FROM ventas WHERE fecha < ?
        `).all(fechaLimite);
        
        if (ventasAntiguas.length > 0) {
            const placeholders = ventasAntiguas.map(() => '?').join(',');
            const idsAntiguos = ventasAntiguas.map(v => v.id);
            
            db.prepare(`DELETE FROM venta_detalles WHERE venta_id IN (${placeholders})`).run(...idsAntiguos);
            db.prepare(`DELETE FROM ventas WHERE fecha < ?`).run(fechaLimite);
            
            console.log(`Limpiadas ${ventasAntiguas.length} ventas antiguas (>30 días)`);
        }
    } catch (error) {
        console.error('Error limpiando ventas antiguas:', error);
    }
}

function getDb() {
    if (!db) {
        return initDatabase();
    }
    return db;
}

function getLicenciaNegocio(negocioId) {
    try {
        const negocio = db.prepare(`
            SELECT licencia_plan, licencia_fecha_inicio, licencia_fecha_expiracion, licencia_hardware_id
            FROM negocios WHERE id = ?
        `).get(negocioId);
        
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

function iniciarTrialNegocio(negocioId) {
    try {
        const licencia = getLicenciaNegocio(negocioId);
        
        if (licencia && licencia.fechaInicio) {
            return licencia.fechaInicio;
        }
        
        const fechaInicio = new Date().toISOString();
        db.prepare(`
            UPDATE negocios SET licencia_fecha_inicio = ? WHERE id = ?
        `).run(fechaInicio, negocioId);
        
        return fechaInicio;
    } catch (error) {
        console.error('Error iniciarTrialNegocio:', error);
        return null;
    }
}

function activarLicenciaNegocio(negocioId, plan, dias, hardwareId) {
    try {
        const fechaInicio = new Date();
        const fechaExpiracion = new Date();
        fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);
        
        db.prepare(`
            UPDATE negocios SET 
                licencia_plan = ?,
                licencia_fecha_inicio = ?,
                licencia_fecha_expiracion = ?,
                licencia_hardware_id = ?
            WHERE id = ?
        `).run(plan, fechaInicio.toISOString(), fechaExpiracion.toISOString(), hardwareId, negocioId);
        
        return {
            plan: plan,
            fechaInicio: fechaInicio.toISOString(),
            fechaExpiracion: fechaExpiracion.toISOString()
        };
    } catch (error) {
        console.error('Error activarLicenciaNegocio:', error);
        return null;
    }
}

function getDiasLicenciaNegocio(negocioId) {
    const licencia = getLicenciaNegocio(negocioId);
    
    if (!licencia) return { valid: false, type: 'trial', daysRemaining: 7 };
    
    if (licencia.plan !== 'trial') {
        if (licencia.hardwareId) {
            const { getMachineId } = require('./license');
            if (licencia.hardwareId !== getMachineId()) {
                return { valid: false, type: 'wrong_hardware', daysRemaining: 0, message: 'Licencia activa en otra computadora' };
            }
        }
        
        if (licencia.fechaExpiracion) {
            const expDate = new Date(licencia.fechaExpiracion);
            const now = new Date();
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
    }
    
    if (licencia.fechaInicio) {
        const TRIAL_DAYS = 7;
        const startDate = new Date(licencia.fechaInicio);
        const now = new Date();
        const daysUsed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const daysRemaining = TRIAL_DAYS - daysUsed;
        return { 
            valid: daysRemaining > 0, 
            type: 'trial', 
            daysRemaining: Math.max(0, daysRemaining),
            licenciaPlan: licencia.plan,
            licenciaFechaInicio: licencia.fechaInicio,
            licenciaFechaExpiracion: licencia.fechaExpiracion
        };
    }
    
    return { valid: true, type: 'trial', daysRemaining: 7 };
}

module.exports = { 
    getDb, 
    initDatabase, 
    limpiarVentasAntiguas,
    getLicenciaNegocio,
    iniciarTrialNegocio,
    activarLicenciaNegocio,
    getDiasLicenciaNegocio
};
