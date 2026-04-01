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
    
    // Tabla de configuración por negocio
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL UNIQUE,
                caja_cerrada INTEGER DEFAULT 0,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
    } catch (e) {}
    
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
    
    const hasLoginAttempts = userColumns.some(c => c.name === 'login_attempts');
    if (!hasLoginAttempts) {
        db.exec('ALTER TABLE usuarios ADD COLUMN login_attempts INTEGER DEFAULT 0');
    }
    
    const hasLastAttempt = userColumns.some(c => c.name === 'last_attempt');
    if (!hasLastAttempt) {
        db.exec('ALTER TABLE usuarios ADD COLUMN last_attempt TEXT');
    }
    
    const negocioColumns = db.prepare("PRAGMA table_info(negocios)").all();
    const hasLicenciaPlan = negocioColumns.some(c => c.name === 'licencia_plan');
    if (!hasLicenciaPlan) {
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_plan TEXT DEFAULT "trial"');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_fecha_inicio TEXT');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_fecha_expiracion TEXT');
        db.exec('ALTER TABLE negocios ADD COLUMN licencia_hardware_id TEXT');
    }
    
    const hasBufferCitas = negocioColumns.some(c => c.name === 'buffer_entre_citas');
    if (!hasBufferCitas) {
        db.exec('ALTER TABLE negocios ADD COLUMN buffer_entre_citas INTEGER DEFAULT 0');
    }
    
    const hasZonaHoraria = negocioColumns.some(c => c.name === 'zona_horaria');
    if (!hasZonaHoraria) {
        db.exec('ALTER TABLE negocios ADD COLUMN zona_horaria INTEGER DEFAULT -4');
    }
    
    // Agregar columna cuadre_id a ventas para separar turnos de caja
    const ventasColumns = db.prepare("PRAGMA table_info(ventas)").all();
    const hasCuadreId = ventasColumns.some(c => c.name === 'cuadre_id');
    if (!hasCuadreId) {
        console.log('Agregando columna cuadre_id a tabla ventas...');
        db.exec('ALTER TABLE ventas ADD COLUMN cuadre_id INTEGER');
        console.log('Columna cuadre_id agregada.');
    }
    
    // Limpiar citas erróneas del 2026-03-24 (bug de fecha)
    const citasErroneas = db.prepare("SELECT COUNT(*) as count FROM citas WHERE fecha = '2026-03-24'").get();
    if (citasErroneas.count > 0) {
        console.log(`Limpiando ${citasErroneas.count} citas erróneas del 2026-03-24...`);
        db.prepare("DELETE FROM citas WHERE fecha = '2026-03-24'").run();
        console.log('Citas erróneas eliminadas.');
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
    
    // Agregar columna imagen a servicios
    const serviciosColumns = db.prepare("PRAGMA table_info(servicios)").all();
    const hasImagen = serviciosColumns.some(c => c.name === 'imagen');
    if (!hasImagen) {
        db.exec('ALTER TABLE servicios ADD COLUMN imagen TEXT');
    }
    
    // Agregar columna subtipo a estado_resultado_items
    const erColumns = db.prepare("PRAGMA table_info(estado_resultado_items)").all();
    const hasSubtipo = erColumns.some(c => c.name === 'subtipo');
    if (!hasSubtipo) {
        db.exec('ALTER TABLE estado_resultado_items ADD COLUMN subtipo TEXT');
        db.exec("UPDATE estado_resultado_items SET subtipo = 'costo' WHERE tipo = 'gasto' AND categoria IN ('costo_ventas', 'gastos_operativos', 'otros_gastos')");
        db.exec("UPDATE estado_resultado_items SET subtipo = 'gasto' WHERE tipo = 'gasto' AND categoria = 'gastos_personales'");
    }
    
    // Agregar columnas subtotal, itbis, descuento
    const hasSubtotal = erColumns.some(c => c.name === 'subtotal');
    if (!hasSubtotal) {
        db.exec('ALTER TABLE estado_resultado_items ADD COLUMN subtotal REAL DEFAULT 0');
        db.exec('ALTER TABLE estado_resultado_items ADD COLUMN itbis REAL DEFAULT 0');
        db.exec('ALTER TABLE estado_resultado_items ADD COLUMN descuento REAL DEFAULT 0');
    }

    // Agregar columnas cuadre_id, metodo_pago, hora a estado_resultado_items
    const erColumnsUpdated = db.prepare("PRAGMA table_info(estado_resultado_items)").all();
    if (!erColumnsUpdated.some(c => c.name === 'cuadre_id')) {
        db.exec('ALTER TABLE estado_resultado_items ADD COLUMN cuadre_id INTEGER');
        console.log('Columna cuadre_id agregada a estado_resultado_items.');
    }
    if (!erColumnsUpdated.some(c => c.name === 'metodo_pago')) {
        db.exec("ALTER TABLE estado_resultado_items ADD COLUMN metodo_pago TEXT DEFAULT 'efectivo'");
        console.log('Columna metodo_pago agregada a estado_resultado_items.');
    }
    if (!erColumnsUpdated.some(c => c.name === 'hora')) {
        db.exec("ALTER TABLE estado_resultado_items ADD COLUMN hora TEXT");
        console.log('Columna hora agregada a estado_resultado_items.');
    }
    
    // Verificar si la categoría gastos_personales está permitida (si no, recrear la tabla)
    try {
        db.exec("INSERT INTO estado_resultado_items (negocio_id, tipo, categoria, descripcion, monto, fecha) VALUES (999, 'gasto', 'gastos_personales', 'test', 1, '2024-01-01')");
        db.exec("DELETE FROM estado_resultado_items WHERE negocio_id = 999");
    } catch (e) {
        if (e.message.includes('CHECK constraint')) {
            console.log('Reconstruyendo tabla estado_resultado_items para soportar gastos_personales...');
            // Limpiar tabla temporal si existe de intento anterior fallido
            db.exec("DROP TABLE IF EXISTS estado_resultado_items_new");
            db.exec(`
                CREATE TABLE estado_resultado_items_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    negocio_id INTEGER NOT NULL,
                    tipo TEXT NOT NULL,
                    subtipo TEXT,
                    categoria TEXT NOT NULL,
                    descripcion TEXT NOT NULL,
                    subtotal REAL DEFAULT 0,
                    itbis REAL DEFAULT 0,
                    descuento REAL DEFAULT 0,
                    monto REAL NOT NULL DEFAULT 0,
                    metodo_pago TEXT DEFAULT 'efectivo',
                    cuadre_id INTEGER,
                    hora TEXT,
                    fecha TEXT NOT NULL,
                    notas TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO estado_resultado_items_new (id, negocio_id, tipo, subtipo, categoria, descripcion, subtotal, itbis, descuento, monto, metodo_pago, cuadre_id, hora, fecha, notas, created_at)
                SELECT id, negocio_id, tipo, subtipo, categoria, descripcion, subtotal, itbis, descuento, monto, metodo_pago, cuadre_id, hora, fecha, notas, created_at FROM estado_resultado_items;
                DROP TABLE estado_resultado_items;
                ALTER TABLE estado_resultado_items_new RENAME TO estado_resultado_items;
            `);
        }
    }
    
    // Agregar columna banco a ventas
    const ventasCols = db.prepare("PRAGMA table_info(ventas)").all();
    if (!ventasCols.some(c => c.name === 'banco')) {
        db.exec('ALTER TABLE ventas ADD COLUMN banco TEXT');
    }
    
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
    
    if (!licencia) return { valid: true, type: 'trial', daysRemaining: 7 };
    
    // Plan pagado (mensual, semestral, anual)
    if (licencia.plan && licencia.plan !== 'trial') {
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
        // Plan pagado sin fecha de expiración = válido sin límite
        return { 
            valid: true, 
            type: licencia.plan, 
            daysRemaining: 999,
            licenciaPlan: licencia.plan,
            licenciaFechaInicio: licencia.fechaInicio,
            licenciaFechaExpiracion: null
        };
    }
    
    // Trial: calcular desde fecha de inicio
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
            licenciaPlan: 'trial',
            licenciaFechaInicio: licencia.fechaInicio,
            licenciaFechaExpiracion: null
        };
    }
    
    // Sin datos = nuevo trial
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
