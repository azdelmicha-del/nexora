const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

function initFullDatabase() {
    console.log('Verificando si se necesita importar BD...');
    
    const db = getDb();
    
    // PROTECCIÓN: Verificar si hay datos existentes
    const negocios = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
    const usuarios = db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count;
    const ventas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
    const citas = db.prepare('SELECT COUNT(*) as count FROM citas').get().count;
    
    // REGLA ABSOLUTA: Si hay CUALQUIER dato, NO hacer NADA
    if (negocios > 0 || usuarios > 0 || ventas > 0 || citas > 0) {
        console.log('✅ BD tiene datos existentes - PROTEGIDA');
        console.log(`   Negocios: ${negocios}, Usuarios: ${usuarios}, Ventas: ${ventas}, Citas: ${citas}`);
        console.log('   NO se importará backup para proteger datos del cliente');
        return;
    }
    
    console.log('BD está completamente vacía, importando datos iniciales...');
    
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
