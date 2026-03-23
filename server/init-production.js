const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'nexora.db');

function initProductionData() {
    console.log('Verificando datos de producción...');
    
    const db = new Database(dbPath);
    
    // Verificar si ya hay negocios
    const negociosCount = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    
    if (negociosCount > 0) {
        console.log(`✅ Base de datos ya tiene ${negociosCount} negocios`);
        db.close();
        return;
    }
    
    console.log('Inicializando base de datos con estructura completa...');
    
    // ============================================
    // CREAR NEGOCIO PRINCIPAL (TU NEGOCIO)
    // ============================================
    const negocioResult = db.prepare(`
        INSERT INTO negocios (
            nombre, slug, telefono, email, 
            estado, licencia_plan, licencia_fecha_inicio,
            hora_apertura, hora_cierre, dias_laborales,
            moneda, booking_activo
        ) VALUES (?, ?, ?, ?, 'activo', 'premium', datetime('now'), '08:00', '18:00', '1,2,3,4,5', 'RD$', 1)
    `).run(
        'Ava Shop Express',
        'ava-shop-express',
        '(809) 775-8962',
        'azdelmicha@gmail.com'
    );
    
    const negocioId = negocioResult.lastInsertRowid;
    console.log(`✅ Negocio creado: ID ${negocioId}`);
    
    // ============================================
    // CREAR TU USUARIO ADMIN PRINCIPAL
    // ============================================
    const hashedPassword = bcrypt.hashSync('Admin2026!', 10);
    
    db.prepare(`
        INSERT INTO usuarios (negocio_id, nombre, email, password, rol, estado, horario_tipo, hora_entrada, hora_salida) 
        VALUES (?, ?, ?, ?, 'admin', 'activo', 'completo', '08:00', '18:00')
    `).run(negocioId, 'Arsedo Zabala', 'azdelmicha@gmail.com', hashedPassword);
    
    console.log('✅ Usuario admin creado: azdelmicha@gmail.com');
    
    // ============================================
    // CREAR CATEGORÍAS DE EJEMPLO
    // ============================================
    const categorias = [
        { nombre: 'Depilación' },
        { nombre: 'Manicura' },
        { nombre: 'Pedicure' },
        { nombre: 'Corte de Cabello' }
    ];
    
    const categoriaIds = {};
    for (const cat of categorias) {
        const result = db.prepare('INSERT INTO categorias (negocio_id, nombre, estado) VALUES (?, ?, ?)').run(negocioId, cat.nombre, 'activo');
        categoriaIds[cat.nombre] = result.lastInsertRowid;
    }
    console.log('✅ Categorías creadas');
    
    // ============================================
    // CREAR SERVICIOS DE EJEMPLO
    // ============================================
    const servicios = [
        { nombre: 'Despigmentación', precio: 850, duracion: 30, categoria: 'Depilación' },
        { nombre: 'Soft Gel XS', precio: 500, duracion: 60, categoria: 'Manicura' },
        { nombre: 'Soft Gel S', precio: 550, duracion: 60, categoria: 'Manicura' },
        { nombre: 'Soft Gel M', precio: 650, duracion: 60, categoria: 'Manicura' },
        { nombre: 'Corte de Pelo', precio: 350, duracion: 30, categoria: 'Corte de Cabello' },
        { nombre: 'Cejas', precio: 500, duracion: 10, categoria: 'Pedicure' },
        { nombre: 'Labios', precio: 500, duracion: 5, categoria: 'Pedicure' },
        { nombre: 'Barba', precio: 150, duracion: 15, categoria: 'Depilación' }
    ];
    
    for (const serv of servicios) {
        db.prepare('INSERT INTO servicios (negocio_id, nombre, precio, duracion, categoria_id, estado) VALUES (?, ?, ?, ?, ?, ?)').run(
            negocioId, serv.nombre, serv.precio, serv.duracion, categoriaIds[serv.categoria], 'activo'
        );
    }
    console.log('✅ Servicios creados');
    
    // ============================================
    // CREAR CLIENTES DE EJEMPLO
    // ============================================
    const clientes = [
        { nombre: 'Cliente Ejemplo 1', telefono: '809-123-4567', email: 'cliente1@email.com' },
        { nombre: 'Cliente Ejemplo 2', telefono: '809-234-5678', email: 'cliente2@email.com' }
    ];
    
    for (const cliente of clientes) {
        db.prepare('INSERT INTO clientes (negocio_id, nombre, telefono, email) VALUES (?, ?, ?, ?)').run(
            negocioId, cliente.nombre, cliente.telefono, cliente.email
        );
    }
    console.log('✅ Clientes creados');
    
    console.log('');
    console.log('========================================');
    console.log('✅ BASE DE DATOS INICIALIZADA');
    console.log('========================================');
    console.log('');
    console.log('📧 Email: azdelmicha@gmail.com');
    console.log('🔑 Contraseña: Admin2026!');
    console.log('');
    console.log('⚠️  IMPORTANTE: Cambia la contraseña después del primer inicio de sesión.');
    console.log('');
    
    db.close();
}

module.exports = { initProductionData };
