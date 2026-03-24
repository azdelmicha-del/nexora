const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function initFullDatabase() {
    console.log('Verificando si se necesita importar BD completa...');
    
    const db = getDb();
    
    // Verificar cuántos negocios hay
    const count = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    const ventas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
    
    // Si ya hay negocios Y ventas, NO importar
    if (count >= 6 && ventas > 0) {
        console.log(`✅ BD ya tiene ${count} negocios y ${ventas} ventas, NO se importa backup`);
        return;
    }
    
    console.log(`BD tiene ${count} negocios y ${ventas} ventas, importando datos completos...`);
    
    // Leer el backup SQL
    const backupPath = path.join(__dirname, 'db', 'nexora-backup.sql');
    
    if (!fs.existsSync(backupPath)) {
        console.log('⚠️ No se encontró archivo de backup, saltando importación');
        return;
    }
    
    try {
        // Limpiar BD antes de importar
        console.log('Limpiando BD antes de importar...');
        db.exec('DELETE FROM venta_detalles');
        db.exec('DELETE FROM ventas');
        db.exec('DELETE FROM citas');
        db.exec('DELETE FROM notificaciones');
        db.exec('DELETE FROM clientes');
        db.exec('DELETE FROM servicios');
        db.exec('DELETE FROM categorias');
        db.exec('DELETE FROM usuarios');
        db.exec('DELETE FROM negocios');
        db.exec('DELETE FROM cajas_cerradas');
        db.exec('DELETE FROM super_admins');
        db.exec('DELETE FROM conversaciones');
        
        const sql = fs.readFileSync(backupPath, 'utf8');
        
        // Ejecutar el SQL de importación
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(sql);
        db.exec('PRAGMA foreign_keys = ON;');
        
        // Verificar que se importaron los datos
        const newCount = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        const newVentas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
        console.log(`✅ BD importada exitosamente: ${newCount} negocios, ${newVentas} ventas`);
        
    } catch (error) {
        console.error('Error importando BD:', error.message);
    }
}

module.exports = { initFullDatabase };
