-- Tabla: Super Admins
CREATE TABLE IF NOT EXISTS super_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    nombre TEXT NOT NULL,
    estado TEXT DEFAULT 'activo',
    fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
);
