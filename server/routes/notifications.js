const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { sin_leer } = req.query;

        let query = `
            SELECT n.id, n.tipo, n.mensaje, n.referencia_id, n.leida, n.fecha
            FROM notificaciones n
            WHERE n.negocio_id = ?
        `;
        const params = [req.session.negocioId];

        if (sin_leer === 'true') {
            query += ' AND n.leida = 0';
        }

        query += ' ORDER BY n.fecha DESC LIMIT 50';

        const notificaciones = db.prepare(query).all(...params);
        res.json(notificaciones);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

router.get('/contador', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const resultado = db.prepare(`
            SELECT COUNT(*) as total
            FROM notificaciones
            WHERE negocio_id = ? AND leida = 0
        `).get(req.session.negocioId);
        res.json({ total: resultado.total });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

router.put('/:id/leer', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const notificacionId = req.params.id;

        const notificacion = db.prepare(`
            SELECT id FROM notificaciones 
            WHERE id = ? AND negocio_id = ?
        `).get(notificacionId, req.session.negocioId);

        if (!notificacion) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }

        db.prepare('UPDATE notificaciones SET leida = 1 WHERE id = ?').run(notificacionId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al marcar como leída' });
    }
});

router.put('/leer-todas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        db.prepare(`
            UPDATE notificaciones 
            SET leida = 1 
            WHERE negocio_id = ? AND leida = 0
        `).run(req.session.negocioId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const notificacionId = req.params.id;

        const notificacion = db.prepare(`
            SELECT id FROM notificaciones 
            WHERE id = ? AND negocio_id = ?
        `).get(notificacionId, req.session.negocioId);

        if (!notificacion) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }

        db.prepare('DELETE FROM notificaciones WHERE id = ?').run(notificacionId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

module.exports = router;
