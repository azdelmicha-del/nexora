const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function initFullDatabase() {
    console.log('Verificando si se necesita importar BD...');
    
    const db = getDb();
    
    // SOLO importar si NO hay negocios (BD completamente vacía)
    const count = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    
    if (count > 0) {
        console.log(`✅ BD ya tiene ${count} negocios, NO se toca`);
        return;
    }
    
    console.log('BD está vacía, importando datos iniciales...');
    
    const backupPath = path.join(__dirname, 'db', 'nexora-backup.sql');
    
    if (!fs.existsSync(backupPath)) {
        console.log('⚠️ No se encontró backup');
        return;
    }
    
    try {
        const sql = fs.readFileSync(backupPath, 'utf8');
        db.exec('PRAGMA foreign_keys = OFF;');
        db.exec(sql);
        db.exec('PRAGMA foreign_keys = ON;');
        
        const newCount = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        console.log(`✅ BD importada: ${newCount} negocios`);
    } catch (error) {
        console.error('Error importando BD:', error.message);
    }
}

module.exports = { initFullDatabase };
