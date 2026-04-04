const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'nexora.db');
const db = new Database(dbPath);

const SUPER_ADMIN_CONFIG = {
    email: process.env.SUPERADMIN_EMAIL || 'azdelmicha@gmail.com',
    password: process.env.SUPERADMIN_PASSWORD || 'Admin20261',
    nombre: 'Arsedo Zabala - Super Admin'
};

function createSuperAdmin() {
    console.log('Verificando super administrador...');
    
    // Crear tabla si no existe
    db.exec(`
        CREATE TABLE IF NOT EXISTS super_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            nombre TEXT NOT NULL,
            estado TEXT DEFAULT 'activo',
            fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Verificar si el super admin existe
    const existingAdmin = db.prepare('SELECT id, email FROM super_admins WHERE email = ?').get(SUPER_ADMIN_CONFIG.email);
    
    if (existingAdmin) {
        console.log(`✅ Super administrador ya existe: ${existingAdmin.email} (ID: ${existingAdmin.id})`);
        return;
    }
    
    // Hash de la contraseña
    const hashedPassword = bcrypt.hashSync(SUPER_ADMIN_CONFIG.password, 10);
    
    // Crear super administrador
    const result = db.prepare(`
        INSERT INTO super_admins (email, password, nombre, estado) 
        VALUES (?, ?, ?, 'activo')
    `).run(SUPER_ADMIN_CONFIG.email, hashedPassword, SUPER_ADMIN_CONFIG.nombre);
    
    console.log('✅ Super administrador creado exitosamente:');
    console.log(`   Email: ${SUPER_ADMIN_CONFIG.email}`);
    console.log(`   Contraseña: ${SUPER_ADMIN_CONFIG.password}`);
    console.log('');
    console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer inicio de sesión.');
}

module.exports = { createSuperAdmin };
