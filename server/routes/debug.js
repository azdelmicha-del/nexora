const express = require('express');
const { getDb } = require('../database');
const { autoBackup } = require('../backup-protection');
const router = express.Router();

// Middleware: solo superadmin autenticado
function requireDebugAuth(req, res, next) {
    if (!req.session.superAdminId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// Endpoint para verificar datos
router.get('/debug/data', requireDebugAuth, (req, res) => {
    try {
        const db = getDb();
        
        const negocios = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        const ventas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
        const citas = db.prepare('SELECT COUNT(*) as count FROM citas').get().count;
        const clientes = db.prepare('SELECT COUNT(*) as count FROM clientes').get().count;
        const usuarios = db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count;
        
        res.json({
            negocios,
            usuarios,
            ventas,
            citas,
            clientes,
            message: 'Datos en BD'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para hacer backup manual
router.post('/debug/backup', requireDebugAuth, (req, res) => {
    try {
        const backupPath = autoBackup();
        if (backupPath) {
            res.json({ success: true, message: 'Backup creado exitosamente' });
        } else {
            res.status(500).json({ error: 'Error al crear backup' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
