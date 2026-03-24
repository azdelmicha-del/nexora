const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function initFullDatabase() {
    console.log('Verificando si se necesita importar BD completa...');
    
    const db = getDb();
    
    // Verificar cuántos negocios hay
    const count = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    
    // Si ya hay datos, NO importar nada
    if (count > 0) {
        console.log(`✅ BD ya tiene ${count} negocios, NO se importa backup`);
        return;
    }
    
    console.log(`BD está vacía, importando datos iniciales...`);
    
    // Leer el backup SQL
    const backupPath = path.join(__dirname, 'db', 'nexora-backup.sql');
    
    if (!fs.existsSync(backupPath)) {
        console.log('⚠️ No se encontró archivo de backup, saltando importación');
        return;
    }
    
    try {
        const sql = fs.readFileSync(backupPath, 'utf8');
        
        // Ejecutar el SQL de importación
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(sql);
        db.exec('PRAGMA foreign_keys = ON;');
        
        // Verificar que se importaron los datos
        const newCount = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        console.log(`✅ BD importada exitosamente: ${newCount} negocios`);
        
    } catch (error) {
        console.error('Error importando BD:', error.message);
    }
}

module.exports = { initFullDatabase };
