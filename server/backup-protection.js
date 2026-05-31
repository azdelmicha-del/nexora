/**
 * Backup protection - deshabilitado para MongoDB
 * MongoDB Atlas maneja backups automaticamente
 */

function getBackupDir() {
    return './backups';
}

function autoBackup() {
    console.log('ℹ️  Backup automatico: MongoDB Atlas maneja backups automaticamente');
    return null;
}

function cleanOldBackups() {
    // No aplica para MongoDB
}

function checkDatabaseIntegrity() {
    try {
        const db = require('./database').getDb();
        if (db && db.readyState === 1) {
            console.log('✅ MongoDB conectado y operativo');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error verificando MongoDB:', error.message);
        return false;
    }
}

module.exports = {
    autoBackup,
    cleanOldBackups,
    checkDatabaseIntegrity,
    getBackupDir
};
