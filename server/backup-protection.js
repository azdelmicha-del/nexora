const fs = require('fs');
const path = require('path');
const { getDb } = require('./database');

// Función para hacer backup automático de la BD
function autoBackup() {
    try {
        const db = getDb();
        const backupDir = path.join(__dirname, 'db', 'backups');
        
        // Crear directorio de backups si no existe
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Nombre del backup con timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `nexora-backup-${timestamp}.db`);
        
        // Hacer backup usando el método de better-sqlite3
        db.backup(backupPath);
        
        console.log(`✅ Backup automático creado: ${backupPath}`);
        
        // Eliminar backups más antiguos de 7 días
        cleanOldBackups(backupDir);
        
        return backupPath;
    } catch (error) {
        console.error('Error en backup automático:', error.message);
        return null;
    }
}

// Función para limpiar backups antiguos
function cleanOldBackups(backupDir) {
    try {
        const files = fs.readdirSync(backupDir);
        const now = Date.now();
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        
        files.forEach(file => {
            if (file.endsWith('.db')) {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime.getTime() < sevenDaysAgo) {
                    fs.unlinkSync(filePath);
                    console.log(`Backup antiguo eliminado: ${file}`);
                }
            }
        });
    } catch (error) {
        console.error('Error limpiando backups:', error.message);
    }
}

// Función para verificar integridad de la BD
function checkDatabaseIntegrity() {
    try {
        const db = getDb();
        
        // Verificar que las tablas principales existen
        const tables = ['negocios', 'usuarios', 'servicios', 'clientes', 'ventas', 'citas'];
        
        for (const table of tables) {
            const result = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
            if (!result) {
                console.error(`❌ Tabla ${table} no existe`);
                return false;
            }
        }
        
        console.log('✅ Integridad de BD verificada');
        return true;
    } catch (error) {
        console.error('Error verificando integridad:', error.message);
        return false;
    }
}

module.exports = { 
    autoBackup, 
    cleanOldBackups,
    checkDatabaseIntegrity
};
