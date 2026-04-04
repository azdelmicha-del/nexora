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
    
    // Migración: Agregar campos e-CF a tabla ventas
    const ventasColsECF = db.prepare("PRAGMA table_info(ventas)").all();
    const ventasColNames = ventasColsECF.map(c => c.name);
    
    if (!ventasColNames.includes('tipo_ecf')) {
        db.exec("ALTER TABLE ventas ADD COLUMN tipo_ecf TEXT DEFAULT '31'");
        console.log('Columna tipo_ecf agregada a ventas.');
    }
    if (!ventasColNames.includes('secuencia_ecf')) {
        db.exec("ALTER TABLE ventas ADD COLUMN secuencia_ecf TEXT");
        console.log('Columna secuencia_ecf agregada a ventas.');
    }
    if (!ventasColNames.includes('codigo_seguridad')) {
        db.exec("ALTER TABLE ventas ADD COLUMN codigo_seguridad TEXT");
        console.log('Columna codigo_seguridad agregada a ventas.');
    }
    if (!ventasColNames.includes('track_id')) {
        db.exec("ALTER TABLE ventas ADD COLUMN track_id TEXT");
        console.log('Columna track_id agregada a ventas.');
    }
    if (!ventasColNames.includes('xml_generado')) {
        db.exec("ALTER TABLE ventas ADD COLUMN xml_generado TEXT");
        console.log('Columna xml_generado agregada a ventas.');
    }
    if (!ventasColNames.includes('estado_dgii')) {
        db.exec("ALTER TABLE ventas ADD COLUMN estado_dgii TEXT DEFAULT 'pendiente'");
        console.log('Columna estado_dgii agregada a ventas.');
    }
    if (!ventasColNames.includes('subtotal')) {
        db.exec("ALTER TABLE ventas ADD COLUMN subtotal REAL DEFAULT 0");
        console.log('Columna subtotal agregada a ventas.');
    }
    if (!ventasColNames.includes('itbis')) {
        db.exec("ALTER TABLE ventas ADD COLUMN itbis REAL DEFAULT 0");
        console.log('Columna itbis agregada a ventas.');
    }
    
    // Crear tabla certificados_dgii si no existe
    db.exec(`
        CREATE TABLE IF NOT EXISTS certificados_dgii (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            negocio_id INTEGER NOT NULL UNIQUE,
            alias TEXT NOT NULL,
            rnc_negocio TEXT NOT NULL,
            archivo_p12_path TEXT NOT NULL,
            pin_encriptado TEXT NOT NULL,
            fecha_vencimiento TEXT,
            estado TEXT DEFAULT 'activo',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (negocio_id) REFERENCES negocios(id)
        )
    `);
    
    // Migración: Agregar campos RNC a negocios
    const negociosCols = db.prepare("PRAGMA table_info(negocios)").all();
    const negociosColNames = negociosCols.map(c => c.name);
    
    if (!negociosColNames.includes('rnc')) {
        db.exec("ALTER TABLE negocios ADD COLUMN rnc TEXT");
        console.log('Columna rnc agregada a negocios.');
    }
    if (!negociosColNames.includes('nombre_legal')) {
        db.exec("ALTER TABLE negocios ADD COLUMN nombre_legal TEXT");
        console.log('Columna nombre_legal agregada a negocios.');
    }
    if (!negociosColNames.includes('logo_url')) {
        db.exec("ALTER TABLE negocios ADD COLUMN logo_url TEXT");
        console.log('Columna logo_url agregada a negocios.');
    }
    if (!negociosColNames.includes('regimen_itbis')) {
        db.exec("ALTER TABLE negocios ADD COLUMN regimen_itbis TEXT DEFAULT 'incluido'");
        console.log('Columna regimen_itbis agregada a negocios.');
    }
    if (!negociosColNames.includes('estado_dgii')) {
        db.exec("ALTER TABLE negocios ADD COLUMN estado_dgii TEXT DEFAULT 'no_inscrito'");
        console.log('Columna estado_dgii agregada a negocios.');
    }
    if (!negociosColNames.includes('certificado_path')) {
        db.exec("ALTER TABLE negocios ADD COLUMN certificado_path TEXT");
        console.log('Columna certificado_path agregada a negocios.');
    }
    if (!negociosColNames.includes('certificado_pass')) {
        db.exec("ALTER TABLE negocios ADD COLUMN certificado_pass TEXT");
        console.log('Columna certificado_pass agregada a negocios.');
    }
    if (!negociosColNames.includes('ambiente_dgii')) {
        db.exec("ALTER TABLE negocios ADD COLUMN ambiente_dgii TEXT DEFAULT 'certificacion'");
        console.log('Columna ambiente_dgii agregada a negocios.');
    }
    if (!negociosColNames.includes('cert_vencimiento')) {
        db.exec("ALTER TABLE negocios ADD COLUMN cert_vencimiento TEXT");
        console.log('Columna cert_vencimiento agregada a negocios.');
    }
    if (!negociosColNames.includes('cert_sujeto')) {
        db.exec("ALTER TABLE negocios ADD COLUMN cert_sujeto TEXT");
        console.log('Columna cert_sujeto agregada a negocios.');
    }
    
    // Migración: Agregar documento y tipo_documento a clientes
    const clientesCols = db.prepare("PRAGMA table_info(clientes)").all();
    const clientesColNames = clientesCols.map(c => c.name);
    
    if (!clientesColNames.includes('documento')) {
        db.exec("ALTER TABLE clientes ADD COLUMN documento TEXT");
        console.log('Columna documento agregada a clientes.');
    }
    if (!clientesColNames.includes('tipo_documento')) {
        db.exec("ALTER TABLE clientes ADD COLUMN tipo_documento TEXT");
        console.log('Columna tipo_documento agregada a clientes.');
    }
    
    // Crear tabla secuencias_ncf si no existe
    db.exec(`
        CREATE TABLE IF NOT EXISTS secuencias_ncf (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            negocio_id INTEGER NOT NULL,
            tipo_comprobante TEXT NOT NULL,
            prefijo TEXT NOT NULL,
            secuencia_actual INTEGER DEFAULT 0,
            fecha_ultima_emision TEXT,
            estado TEXT DEFAULT 'activo',
            FOREIGN KEY (negocio_id) REFERENCES negocios(id),
            UNIQUE(negocio_id, tipo_comprobante)
        )
    `);

    // ── Migracion Fiscal v1: estado_resultado_items (egresos) ────────────────
    // ncf_suplidor : NCF del proveedor — permite compensar ITBIS en compras.
    // itbis_pagado : ITBIS real pagado al suplidor (distinto del campo 'itbis'
    //               que ya existia y refleja el ITBIS del documento completo).
    // tipo_gasto   : Clasifica el egreso para reportes de compensacion DGII.
    //               Valores validos: 'insumo' | 'fijo' | 'personal'
    //               (CHECK aplicado en capa de rutas; SQLite no admite CHECK en ALTER TABLE)
    const erFiscalCols = db.prepare("PRAGMA table_info(estado_resultado_items)").all();
    const erFiscalColNames = erFiscalCols.map(c => c.name);

    if (!erFiscalColNames.includes('ncf_suplidor')) {
        db.exec("ALTER TABLE estado_resultado_items ADD COLUMN ncf_suplidor TEXT DEFAULT NULL");
        console.log('Columna ncf_suplidor agregada a estado_resultado_items.');
    }
    if (!erFiscalColNames.includes('itbis_pagado')) {
        db.exec("ALTER TABLE estado_resultado_items ADD COLUMN itbis_pagado REAL DEFAULT 0");
        console.log('Columna itbis_pagado agregada a estado_resultado_items.');
    }
    if (!erFiscalColNames.includes('tipo_gasto')) {
        db.exec("ALTER TABLE estado_resultado_items ADD COLUMN tipo_gasto TEXT DEFAULT NULL");
        console.log('Columna tipo_gasto agregada a estado_resultado_items.');
    }

    // ── Migracion Fiscal v1: servicios ───────────────────────────────────────
    // itbis_tasa           : Tasa ITBIS especifica del servicio (default 18).
    //                        Permite servicios exentos (0) o con tasa reducida (16).
    // costo_insumo_estimado: Costo estimado de insumos consumidos al prestar
    //                        el servicio — base para calcular margen real.
    const serviciosFiscalCols = db.prepare("PRAGMA table_info(servicios)").all();
    const serviciosFiscalColNames = serviciosFiscalCols.map(c => c.name);

    if (!serviciosFiscalColNames.includes('itbis_tasa')) {
        db.exec("ALTER TABLE servicios ADD COLUMN itbis_tasa INTEGER DEFAULT 18");
        console.log('Columna itbis_tasa agregada a servicios.');
    }
    if (!serviciosFiscalColNames.includes('costo_insumo_estimado')) {
        db.exec("ALTER TABLE servicios ADD COLUMN costo_insumo_estimado REAL DEFAULT 0");
        console.log('Columna costo_insumo_estimado agregada a servicios.');
    }

    // ── Migracion Fiscal v1: venta_detalles ──────────────────────────────────
    // itbis_monto: ITBIS calculado y congelado por linea en el momento exacto
    //             de la venta. Si la tasa del servicio cambia en el futuro,
    //             las facturas historicas conservan el valor original.
    const ventaDetFiscalCols = db.prepare("PRAGMA table_info(venta_detalles)").all();
    const ventaDetFiscalColNames = ventaDetFiscalCols.map(c => c.name);

    if (!ventaDetFiscalColNames.includes('itbis_monto')) {
        db.exec("ALTER TABLE venta_detalles ADD COLUMN itbis_monto REAL DEFAULT 0");
        console.log('Columna itbis_monto agregada a venta_detalles.');
    }

    // ── Migracion Fiscal v2: notas_credito ──────────────────────────────────
    // Tabla para Notas de Credito (34) y Debito (33) referenciando ventas originales
    const notasCols = db.prepare("PRAGMA table_info(notas_credito)").all();
    if (notasCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS notas_credito (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                user_id INTEGER,
                venta_original_id INTEGER NOT NULL,
                tipo_nota TEXT NOT NULL CHECK(tipo_nota IN ('33', '34')),
                secuencia_ecf TEXT NOT NULL,
                codigo_seguridad TEXT NOT NULL,
                monto REAL NOT NULL,
                motivo TEXT NOT NULL,
                estado_dgii TEXT DEFAULT 'pendiente',
                xml_path TEXT,
                fecha TEXT NOT NULL,
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (venta_original_id) REFERENCES ventas(id)
            )
        `);
        console.log('Tabla notas_credito creada.');
    }

    // ── Migracion v3: productos (inventario) ────────────────────────────────
    const prodCols = db.prepare("PRAGMA table_info(productos)").all();
    if (prodCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS productos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                precio REAL NOT NULL,
                costo REAL DEFAULT 0,
                stock INTEGER DEFAULT 0,
                stock_minimo INTEGER DEFAULT 5,
                codigo_barras TEXT,
                categoria TEXT,
                itbis_tasa INTEGER DEFAULT 18,
                estado TEXT DEFAULT 'activo',
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
        console.log('Tabla productos creada.');
    }

    // ── Migracion v3: movimientos_inventario ────────────────────────────────
    const movCols = db.prepare("PRAGMA table_info(movimientos_inventario)").all();
    if (movCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS movimientos_inventario (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                producto_id INTEGER NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('entrada', 'salida', 'ajuste', 'venta')),
                cantidad INTEGER NOT NULL,
                costo_unitario REAL DEFAULT 0,
                referencia TEXT,
                user_id INTEGER,
                fecha TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (producto_id) REFERENCES productos(id)
            )
        `);
        console.log('Tabla movimientos_inventario creada.');
    }

    // ── Migracion v3: venta_detalles puede incluir productos ────────────────
    const vdProdCols = db.prepare("PRAGMA table_info(venta_detalles)").all();
    const vdProdColNames = vdProdCols.map(c => c.name);

    // Rebuild table to remove NOT NULL on servicio_id and add new columns
    const needsRebuild = vdProdColNames.includes('producto_id')
        ? db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_detalles'").get()
        : null;
    const hasOldConstraint = needsRebuild && needsRebuild.sql && needsRebuild.sql.includes('servicio_id INTEGER NOT NULL');

    if (hasOldConstraint) {
        db.exec(`
            CREATE TABLE venta_detalles_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                venta_id INTEGER NOT NULL,
                servicio_id INTEGER DEFAULT NULL,
                producto_id INTEGER DEFAULT NULL,
                tipo_item TEXT DEFAULT 'servicio' CHECK(tipo_item IN ('servicio', 'producto')),
                cantidad INTEGER DEFAULT 1,
                precio REAL NOT NULL,
                subtotal REAL NOT NULL,
                itbis_monto REAL DEFAULT 0,
                FOREIGN KEY (venta_id) REFERENCES ventas(id),
                FOREIGN KEY (servicio_id) REFERENCES servicios(id),
                FOREIGN KEY (producto_id) REFERENCES productos(id)
            )
        `);
        db.exec(`
            INSERT INTO venta_detalles_new (id, venta_id, servicio_id, cantidad, precio, subtotal, itbis_monto)
            SELECT id, venta_id, servicio_id, cantidad, precio, subtotal, itbis_monto
            FROM venta_detalles
        `);
        db.exec('DROP TABLE venta_detalles');
        db.exec('ALTER TABLE venta_detalles_new RENAME TO venta_detalles');
        console.log('Tabla venta_detalles reconstruida (servicio_id nullable).');
    } else if (!vdProdColNames.includes('producto_id')) {
        db.exec("ALTER TABLE venta_detalles ADD COLUMN producto_id INTEGER REFERENCES productos(id)");
        console.log('Columna producto_id agregada a venta_detalles.');
    }
    if (!vdProdColNames.includes('tipo_item')) {
        db.exec("ALTER TABLE venta_detalles ADD COLUMN tipo_item TEXT DEFAULT 'servicio' CHECK(tipo_item IN ('servicio', 'producto'))");
        console.log('Columna tipo_item agregada a venta_detalles.');
    }

    // ── Migracion v3: comisiones ────────────────────────────────────────────
    const comCols = db.prepare("PRAGMA table_info(comisiones)").all();
    if (comCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS comisiones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                venta_id INTEGER,
                monto_base REAL NOT NULL,
                porcentaje REAL NOT NULL,
                monto_comision REAL NOT NULL,
                fecha TEXT NOT NULL,
                estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'pagada')),
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (user_id) REFERENCES usuarios(id)
            )
        `);
        console.log('Tabla comisiones creada.');
    }

    // ── Migracion v3: chatbot ───────────────────────────────────────────────
    const chatCols = db.prepare("PRAGMA table_info(chatbot_reglas)").all();
    if (chatCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS chatbot_reglas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                palabra_clave TEXT NOT NULL,
                respuesta TEXT NOT NULL,
                activa INTEGER DEFAULT 1,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
        console.log('Tabla chatbot_reglas creada.');
    }
    const chatMsgCols = db.prepare("PRAGMA table_info(chatbot_mensajes)").all();
    if (chatMsgCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS chatbot_mensajes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                cliente_id INTEGER,
                mensaje TEXT NOT NULL,
                origen TEXT DEFAULT 'cliente' CHECK(origen IN ('cliente', 'bot')),
                regla_id INTEGER,
                fecha TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (cliente_id) REFERENCES clientes(id)
            )
        `);
        console.log('Tabla chatbot_mensajes creada.');
    }

    // ── Migracion v5: log_auditoria ─────────────────────────────────────────
    const auditCols = db.prepare("PRAGMA table_info(log_auditoria)").all();
    if (auditCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS log_auditoria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                user_id INTEGER,
                accion TEXT NOT NULL,
                tabla TEXT,
                registro_id INTEGER,
                detalle TEXT,
                ip TEXT,
                user_agent TEXT,
                fecha TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (user_id) REFERENCES usuarios(id)
            )
        `);
        console.log('Tabla log_auditoria creada.');
    }

    // ── Migracion v5: puntos_lealtad ────────────────────────────────────────
    const loyaltyCols = db.prepare("PRAGMA table_info(puntos_lealtad)").all();
    if (loyaltyCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS puntos_lealtad (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                cliente_id INTEGER NOT NULL,
                puntos INTEGER DEFAULT 0,
                nivel TEXT DEFAULT 'bronce' CHECK(nivel IN ('bronce', 'plata', 'oro', 'platino')),
                ultima_actividad TEXT,
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (cliente_id) REFERENCES clientes(id),
                UNIQUE(negocio_id, cliente_id)
            )
        `);
        console.log('Tabla puntos_lealtad creada.');
    }

    // ── Migracion v5: historial_puntos ──────────────────────────────────────
    const histPtsCols = db.prepare("PRAGMA table_info(historial_puntos)").all();
    if (histPtsCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS historial_puntos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                cliente_id INTEGER NOT NULL,
                puntos INTEGER NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('ganado', 'canjeado', 'ajuste')),
                referencia TEXT,
                fecha TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                FOREIGN KEY (cliente_id) REFERENCES clientes(id)
            )
        `);
        console.log('Tabla historial_puntos creada.');
    }

    // ── Migracion v5: horario_negocio ───────────────────────────────────────
    const horarioCols = db.prepare("PRAGMA table_info(horario_negocio)").all();
    if (horarioCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS horario_negocio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL UNIQUE,
                lunes_apertura TEXT DEFAULT '09:00',
                lunes_cierre TEXT DEFAULT '18:00',
                lunes_activo INTEGER DEFAULT 1,
                martes_apertura TEXT DEFAULT '09:00',
                martes_cierre TEXT DEFAULT '18:00',
                martes_activo INTEGER DEFAULT 1,
                miercoles_apertura TEXT DEFAULT '09:00',
                miercoles_cierre TEXT DEFAULT '18:00',
                miercoles_activo INTEGER DEFAULT 1,
                jueves_apertura TEXT DEFAULT '09:00',
                jueves_cierre TEXT DEFAULT '18:00',
                jueves_activo INTEGER DEFAULT 1,
                viernes_apertura TEXT DEFAULT '09:00',
                viernes_cierre TEXT DEFAULT '18:00',
                viernes_activo INTEGER DEFAULT 1,
                sabado_apertura TEXT DEFAULT '09:00',
                sabado_cierre TEXT DEFAULT '18:00',
                sabado_activo INTEGER DEFAULT 1,
                domingo_apertura TEXT DEFAULT '09:00',
                domingo_cierre TEXT DEFAULT '18:00',
                domingo_activo INTEGER DEFAULT 0,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
        console.log('Tabla horario_negocio creada.');
    }

    // ── Migracion v5: sucursales ────────────────────────────────────────────
    const sucCols = db.prepare("PRAGMA table_info(sucursales)").all();
    if (sucCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS sucursales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                nombre TEXT NOT NULL,
                direccion TEXT,
                telefono TEXT,
                activa INTEGER DEFAULT 1,
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
        console.log('Tabla sucursales creada.');
    }

    // ── Migracion v5: clientes.sucursal_id y clientes.puntos ────────────────
    const cliNewCols = db.prepare("PRAGMA table_info(clientes)").all();
    const cliNewColNames = cliNewCols.map(c => c.name);
    if (!cliNewColNames.includes('sucursal_id')) {
        db.exec("ALTER TABLE clientes ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)");
        console.log('Columna sucursal_id agregada a clientes.');
    }
    if (!cliNewColNames.includes('puntos')) {
        db.exec("ALTER TABLE clientes ADD COLUMN puntos INTEGER DEFAULT 0");
        console.log('Columna puntos agregada a clientes.');
    }
    if (!cliNewColNames.includes('nivel_lealtad')) {
        db.exec("ALTER TABLE clientes ADD COLUMN nivel_lealtad TEXT DEFAULT 'bronce'");
        console.log('Columna nivel_lealtad agregada a clientes.');
    }

    // ── Migracion v5: negocios.logo ─────────────────────────────────────────
    const negCols = db.prepare("PRAGMA table_info(negocios)").all();
    const negColNames = negCols.map(c => c.name);
    if (!negColNames.includes('logo')) {
        db.exec("ALTER TABLE negocios ADD COLUMN logo TEXT");
        console.log('Columna logo agregada a negocios.');
    }

    // ── Migracion v3: whatsapp_config ───────────────────────────────────────
    const waCols = db.prepare("PRAGMA table_info(whatsapp_config)").all();
    if (waCols.length === 0) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS whatsapp_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL UNIQUE,
                token TEXT,
                phone_number_id TEXT,
                activo INTEGER DEFAULT 0,
                plantilla_recordatorio TEXT DEFAULT 'recordatorio_cita',
                plantilla_confirmacion TEXT DEFAULT 'confirmacion_cita',
                FOREIGN KEY (negocio_id) REFERENCES negocios(id)
            )
        `);
        console.log('Tabla whatsapp_config creada.');
    }

    // ── Migracion v3: usuarios.comision_porcentaje ──────────────────────────
    const userComCols = db.prepare("PRAGMA table_info(usuarios)").all();
    const userComColNames = userComCols.map(c => c.name);
    if (!userComColNames.includes('comision_porcentaje')) {
        db.exec("ALTER TABLE usuarios ADD COLUMN comision_porcentaje REAL DEFAULT 0");
        console.log('Columna comision_porcentaje agregada a usuarios.');
    }

    // ── Migracion v4: servicios.comision_porcentaje ─────────────────────────
    const svcComCols = db.prepare("PRAGMA table_info(servicios)").all();
    const svcComColNames = svcComCols.map(c => c.name);
    if (!svcComColNames.includes('comision_porcentaje')) {
        db.exec("ALTER TABLE servicios ADD COLUMN comision_porcentaje REAL DEFAULT 0");
        console.log('Columna comision_porcentaje agregada a servicios.');
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

/**
 * Obtener siguiente secuencia NCF para un negocio y tipo de comprobante
 * @param {number} negocioId
 * @param {string} tipoComprobante - '31' (Consumo), '32' (Crédito Fiscal)
 * @returns {string} Secuencia NCF completa (ej: E310000000001)
 */
function getNextNCF(negocioId, tipoComprobante) {
    try {
        const localDb = getDb();
        
        // Asegurar que la tabla existe
        localDb.exec(`
            CREATE TABLE IF NOT EXISTS secuencias_ncf (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                negocio_id INTEGER NOT NULL,
                tipo_comprobante TEXT NOT NULL,
                prefijo TEXT NOT NULL,
                secuencia_actual INTEGER DEFAULT 0,
                fecha_ultima_emision TEXT,
                estado TEXT DEFAULT 'activo',
                FOREIGN KEY (negocio_id) REFERENCES negocios(id),
                UNIQUE(negocio_id, tipo_comprobante)
            )
        `);
        
        // Prefijos por tipo
        const prefijos = { '31': 'E31', '32': 'E32', '33': 'E33', '34': 'E34' };
        const prefijo = prefijos[tipoComprobante] || 'E31';
        
        // Verificar si existe la secuencia
        const existente = localDb.prepare(
            'SELECT * FROM secuencias_ncf WHERE negocio_id = ? AND tipo_comprobante = ?'
        ).get(negocioId, tipoComprobante);
        
        if (existente) {
            const nuevaSecuencia = existente.secuencia_actual + 1;
            localDb.prepare(
                'UPDATE secuencias_ncf SET secuencia_actual = ?, fecha_ultima_emision = ? WHERE id = ?'
            ).run(nuevaSecuencia, new Date().toISOString(), existente.id);
            
            return `${prefijo}${String(nuevaSecuencia).padStart(10, '0')}`;
        }
        
        // Crear nueva secuencia
        localDb.prepare(
            'INSERT INTO secuencias_ncf (negocio_id, tipo_comprobante, prefijo, secuencia_actual, fecha_ultima_emision) VALUES (?, ?, ?, 1, ?)'
        ).run(negocioId, tipoComprobante, prefijo, new Date().toISOString());
        
        return `${prefijo}0000000001`;
    } catch (error) {
        console.error('Error getNextNCF:', error);
        return `E31${String(Date.now()).slice(-10)}`;
    }
}

module.exports = { 
    getDb, 
    initDatabase, 
    limpiarVentasAntiguas,
    getLicenciaNegocio,
    iniciarTrialNegocio,
    activarLicenciaNegocio,
    getDiasLicenciaNegocio,
    getNextNCF
};
