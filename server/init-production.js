const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'nexora.db');

function initProductionData() {
    console.log('Verificando datos de producción...');
    
    const db = new Database(dbPath);
    
    // Verificar si ya hay datos
    const negociosCount = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    
    if (negociosCount > 0) {
        console.log(`✅ Base de datos ya tiene ${negociosCount} negocios`);
        db.close();
        return;
    }
    
    console.log('Inicializando base de datos con datos de ejemplo...');
    
    // Crear negocio principal
    const negocioResult = db.prepare(`
        INSERT INTO negocios (nombre, slug, telefono, email, estado, licencia_plan, licencia_fecha_inicio) 
        VALUES (?, ?, ?, ?, 'activo', 'premium', datetime('now'))
    `).run('Nexora Demo', 'nexora-demo', '809-000-0000', 'demo@nexora.com');
    
    const negocioId = negocioResult.lastInsertRowid;
    
    // Crear usuario admin
    const hashedPassword = bcrypt.hashSync('Demo2026!', 10);
    
    db.prepare(`
        INSERT INTO usuarios (negocio_id, nombre, email, password, rol, estado) 
        VALUES (?, ?, ?, ?, 'admin', 'activo')
    `).run(negocioId, 'Admin Demo', 'admin@nexora.com', hashedPassword);
    
    // Crear categorías de ejemplo
    const cat1 = db.prepare('INSERT INTO categorias (negocio_id, nombre) VALUES (?, ?)').run(negocioId, 'Corte de Cabello').lastInsertRowid;
    const cat2 = db.prepare('INSERT INTO categorias (negocio_id, nombre) VALUES (?, ?)').run(negocioId, 'Barba').lastInsertRowid;
    
    // Crear servicios de ejemplo
    db.prepare('INSERT INTO servicios (negocio_id, nombre, precio, duracion, categoria_id) VALUES (?, ?, ?, ?, ?)').run(negocioId, 'Corte Clásico', 250, 30, cat1);
    db.prepare('INSERT INTO servicios (negocio_id, nombre, precio, duracion, categoria_id) VALUES (?, ?, ?, ?, ?)').run(negocioId, 'Corte Moderno', 350, 45, cat1);
    db.prepare('INSERT INTO servicios (negocio_id, nombre, precio, duracion, categoria_id) VALUES (?, ?, ?, ?, ?)').run(negocioId, 'Arreglo de Barba', 150, 20, cat2);
    db.prepare('INSERT INTO servicios (negocio_id, nombre, precio, duracion, categoria_id) VALUES (?, ?, ?, ?, ?)').run(negocioId, 'Barba Completa', 250, 30, cat2);
    
    // Crear clientes de ejemplo
    db.prepare('INSERT INTO clientes (negocio_id, nombre, telefono, email) VALUES (?, ?, ?, ?)').run(negocioId, 'Juan Pérez', '809-123-4567', 'juan@email.com');
    db.prepare('INSERT INTO clientes (negocio_id, nombre, telefono, email) VALUES (?, ?, ?, ?)').run(negocioId, 'María García', '809-234-5678', 'maria@email.com');
    
    console.log('✅ Base de datos inicializada con datos de ejemplo');
    console.log('');
    console.log('📧 Email: admin@nexora.com');
    console.log('🔑 Contraseña: Demo2026!');
    console.log('');
    console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer inicio de sesión.');
    
    db.close();
}

module.exports = { initProductionData };
