const express = require('express');
const { getDb } = require('../database');
const router = express.Router();

// Endpoint temporal para verificar datos
router.get('/debug/data', (req, res) => {
    try {
        const db = getDb();
        
        const negocios = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        const ventas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
        const citas = db.prepare('SELECT COUNT(*) as count FROM citas').get().count;
        const clientes = db.prepare('SELECT COUNT(*) as count FROM clientes').get().count;
        
        res.json({
            negocios,
            ventas,
            citas,
            clientes,
            message: 'Endpoint temporal para debug'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
