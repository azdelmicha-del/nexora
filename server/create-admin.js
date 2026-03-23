const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'nexora.db');
const db = new Database(dbPath);

// Configuración del administrador principal
const ADMIN_CONFIG = {
    email: 'azdelmicha@gmail.com',
    password: 'Admin2026!',  // Cambiar esta contraseña
    nombre: 'Arsedo Zabala',
    negocioNombre: 'Nexora Admin',
    negocioSlug: 'nexora-admin'
};

function createMainAdmin() {
    console.log('Verificando administrador principal...');
    
    // Verificar si el usuario admin existe
    const existingUser = db.prepare('SELECT id, email FROM usuarios WHERE email = ?').get(ADMIN_CONFIG.email);
    
    if (existingUser) {
        console.log(`✅ Administrador ya existe: ${existingUser.email} (ID: ${existingUser.id})`);
        return;
    }
    
    // Verificar si el negocio existe
    let negocio = db.prepare('SELECT id FROM negocios WHERE email = ?').get(ADMIN_CONFIG.email);
    
    if (!negocio) {
        console.log('Creando negocio principal...');
        const result = db.prepare(`
            INSERT INTO negocios (nombre, slug, telefono, email, estado, licencia_plan, licencia_fecha_inicio) 
            VALUES (?, ?, ?, ?, 'activo', 'premium', datetime('now'))
        `).run(ADMIN_CONFIG.negocioNombre, ADMIN_CONFIG.negocioSlug, '809-000-0000', ADMIN_CONFIG.email);
        
        console.log(`✅ Negocio creado con ID: ${result.lastInsertRowid}`);
        negocio = { id: result.lastInsertRowid };
    }
    
    // Hash de la contraseña
    const hashedPassword = bcrypt.hashSync(ADMIN_CONFIG.password, 10);
    
    // Crear usuario administrador
    const result = db.prepare(`
        INSERT INTO usuarios (negocio_id, nombre, email, password, rol, estado, fecha_creacion) 
        VALUES (?, ?, ?, ?, 'admin', 'activo', datetime('now'))
    `).run(
        negocio.id,
        ADMIN_CONFIG.nombre,
        ADMIN_CONFIG.email,
        hashedPassword
    );
    
    console.log('✅ Administrador principal creado exitosamente:');
    console.log(`   Email: ${ADMIN_CONFIG.email}`);
    console.log(`   Contraseña: ${ADMIN_CONFIG.password}`);
    console.log(`   Negocio ID: ${negocio.id}`);
    console.log('');
    console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer inicio de sesión.');
}

// Ejecutar
createMainAdmin();

// Cerrar base de datos
db.close();
