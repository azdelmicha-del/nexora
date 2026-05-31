const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/backup — Info de colecciones ( MongoDB no usa archivos .db )
router.get('/', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        const collections = await db.db.listCollections().toArray();
        const stats = [];

        for (const col of collections) {
            const count = await db.db.collection(col.name).countDocuments();
            stats.push({
                nombre: col.name,
                documentos: count
            });
        }

        res.json({
            tipo: 'mongodb',
            base_datos: db.db.databaseName,
            colecciones: stats
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener info de colecciones' });
    }
});

// POST /api/backup — No aplica para MongoDB
router.post('/', requireSuperAdmin, (req, res) => {
    res.json({
        success: true,
        message: 'MongoDB Atlas maneja backups automaticamente. No se requiere backup manual.'
    });
});

// POST /api/backup/restore — No aplica para MongoDB
router.post('/restore', requireSuperAdmin, (req, res) => {
    res.status(400).json({
        error: 'Restore manual no aplica para MongoDB. Usa MongoDB Atlas para restaurar backups.'
    });
});

// DELETE /api/backup/:nombre — No aplica para MongoDB
router.delete('/:nombre', requireSuperAdmin, (req, res) => {
    res.status(400).json({
        error: 'Eliminacion de backups no aplica para MongoDB.'
    });
});

// GET /api/backup/download/:nombre — No aplica para MongoDB
router.get('/download/:nombre', requireSuperAdmin, (req, res) => {
    res.status(400).json({
        error: 'Descarga de backups no aplica para MongoDB.'
    });
});

module.exports = router;
