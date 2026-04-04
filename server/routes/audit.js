const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit — Log de auditoria
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { tabla, user_id, desde, hasta, limit } = req.query;

        let where = 'WHERE l.negocio_id = ?';
        const params = [negocioId];

        if (tabla) { where += ' AND l.tabla = ?'; params.push(tabla); }
        if (user_id) { where += ' AND l.user_id = ?'; params.push(user_id); }
        if (desde) { where += ' AND DATE(l.fecha) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND DATE(l.fecha) <= ?'; params.push(hasta); }

        const logs = db.prepare(`
            SELECT l.id, l.accion, l.tabla, l.registro_id, l.detalle, l.ip, l.fecha,
                   u.nombre as usuario
            FROM log_auditoria l
            LEFT JOIN usuarios u ON l.user_id = u.id
            ${where}
            ORDER BY l.fecha DESC
            LIMIT ?
        `).all(...params, parseInt(limit) || 100);

        const stats = db.prepare(`
            SELECT accion, COUNT(*) as count
            FROM log_auditoria
            WHERE negocio_id = ? AND DATE(fecha) >= date('now', '-30 days')
            GROUP BY accion
            ORDER BY count DESC
        `).all(negocioId);

        res.json({ logs, stats });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener log de auditoria' });
    }
});

// POST /api/audit — Registrar accion (usado internamente)
router.post('/', requireAuth, (req, res) => {
    try {
        const { accion, tabla, registro_id, detalle } = req.body;
        const db = getDb();

        db.prepare(`
            INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            req.session.userId,
            accion,
            tabla || null,
            registro_id || null,
            detalle || null,
            req.ip,
            req.headers['user-agent']
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al registrar auditoria' });
    }
});

module.exports = router;
