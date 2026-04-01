-- Base de datos Nexora - Módulos 1-5

-- Tabla: Negocios (Tenants)
CREATE TABLE IF NOT EXISTS negocios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    slug TEXT UNIQUE,
    telefono TEXT,
    email TEXT,
    direccion TEXT,
    logo TEXT,
    moneda TEXT DEFAULT 'RD$',
    formato_moneda TEXT DEFAULT '$#,##0.00',
    hora_apertura TEXT DEFAULT '09:00',
    hora_cierre TEXT DEFAULT '18:00',
    dias_laborales TEXT DEFAULT '1,2,3,4,5,6,7',
    duracion_minima_cita INTEGER DEFAULT 30,
    permitir_solapamiento INTEGER DEFAULT 0,
    tiempo_anticipacion INTEGER DEFAULT 60,
    tiempo_cancelacion INTEGER DEFAULT 24,
    buffer_entre_citas INTEGER DEFAULT 0,
    zona_horaria INTEGER DEFAULT -4,
    mostrar_impuestos INTEGER DEFAULT 0,
    activar_descuentos INTEGER DEFAULT 1,
    seleccion_obligatoria_cliente INTEGER DEFAULT 0,
    metodo_efectivo INTEGER DEFAULT 1,
    metodo_transferencia INTEGER DEFAULT 1,
    metodo_tarjeta INTEGER DEFAULT 0,
    chatbot_activo INTEGER DEFAULT 0,
    chatbot_bienvenida TEXT DEFAULT '¡Bienvenido! ¿En qué puedo ayudarte?',
    booking_activo INTEGER DEFAULT 1,
    notificaciones_activas INTEGER DEFAULT 1,
    estado TEXT DEFAULT 'activo',
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
    licencia_plan TEXT DEFAULT 'trial',
    licencia_fecha_inicio TEXT,
    licencia_fecha_expiracion TEXT,
    licencia_hardware_id TEXT
);

-- Tabla: Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'empleado',
    estado TEXT DEFAULT 'activo',
    horario_tipo TEXT DEFAULT 'completo',
    hora_entrada TEXT DEFAULT '08:00',
    hora_salida TEXT DEFAULT '18:00',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

-- Tabla: Servicios
CREATE TABLE IF NOT EXISTS servicios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    precio REAL NOT NULL,
    duracion INTEGER NOT NULL,
    categoria_id INTEGER,
    descripcion TEXT,
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

-- Tabla: Categorías
CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

-- Tabla: Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    notas TEXT,
    estado TEXT DEFAULT 'activo',
    fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

-- Tabla: Ventas
CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER,
    user_id INTEGER,
    total REAL NOT NULL,
    descuento REAL DEFAULT 0,
    metodo_pago TEXT NOT NULL,
    fuera_cuadre INTEGER DEFAULT 0,
    cuadre_id INTEGER,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);

-- Tabla: Detalle de Ventas
CREATE TABLE IF NOT EXISTS venta_detalles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    servicio_id INTEGER NOT NULL,
    cantidad INTEGER DEFAULT 1,
    precio REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
);

-- Tabla: Citas
CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,
    servicio_id INTEGER NOT NULL,
    user_id INTEGER,
    fecha TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    hora_fin TEXT NOT NULL,
    estado TEXT DEFAULT 'pendiente',
    origen TEXT DEFAULT 'interno',
    notas TEXT,
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);

-- Tabla: Notificaciones
CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    referencia_id INTEGER,
    leida INTEGER DEFAULT 0,
    fecha TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

-- Tabla: Conversaciones (para chatbot futuro)
CREATE TABLE IF NOT EXISTS conversaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    cliente_id INTEGER,
    estado TEXT DEFAULT 'activa',
    fecha_inicio TEXT DEFAULT CURRENT_TIMESTAMP,
    ultima_actividad TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

-- Tabla: Cajas Cerradas (Histórico de cuadres)
CREATE TABLE IF NOT EXISTS cajas_cerradas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    total REAL NOT NULL,
    cantidad_ventas INTEGER NOT NULL,
    efectivo REAL DEFAULT 0,
    transferencia REAL DEFAULT 0,
    tarjeta REAL DEFAULT 0,
    user_id INTEGER,
    notas TEXT,
    fecha_cierre TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id),
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
);

-- Tabla: Estado de Resultado (Items manuales)
CREATE TABLE IF NOT EXISTS estado_resultado_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('ingreso', 'gasto')),
    subtipo TEXT CHECK(subtipo IN ('costo', 'gasto')),
    categoria TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    itbis REAL DEFAULT 0,
    descuento REAL DEFAULT 0,
    monto REAL NOT NULL DEFAULT 0,
    metodo_pago TEXT DEFAULT 'efectivo',
    cuadre_id INTEGER,
    fecha TEXT NOT NULL,
    hora TEXT,
    notas TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_usuarios_negocio ON usuarios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_servicios_negocio ON servicios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_clientes_negocio ON clientes(negocio_id);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio ON ventas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_citas_negocio ON citas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_negocio ON notificaciones(negocio_id);
