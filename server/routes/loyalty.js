const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/loyalty — Resumen de lealtad
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;

        const clientes = db.prepare(`
            SELECT c.id, c.nombre, c.telefono, c.email,
                   COALESCE(pl.puntos, c.puntos) as puntos,
                   COALESCE(pl.nivel, c.nivel_lealtad, 'bronce') as nivel,
                   pl.ultima_actividad,
                   (SELECT COUNT(*) FROM ventas WHERE negocio_id = ? AND cliente_id = c.id) as total_compras,
                   (SELECT COALESCE(SUM(total),0) FROM ventas WHERE negocio_id = ? AND cliente_id = c.id) as total_gastado
            FROM clientes c
            LEFT JOIN puntos_lealtad pl ON c.id = pl.cliente_id AND pl.negocio_id = ?
            WHERE c.negocio_id = ?
            ORDER BY puntos DESC
            LIMIT 50
        `).all(negocioId, negocioId, negocioId, negocioId);

        const stats = db.prepare(`
            SELECT nivel, COUNT(*) as count, COALESCE(SUM(puntos),0) as total_puntos
            FROM puntos_lealtad
            WHERE negocio_id = ?
            GROUP BY nivel
        `).all(negocioId);

        res.json({ clientes, stats });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener datos de lealtad' });
    }
});

// POST /api/loyalty/puntos — Agregar puntos a cliente
router.post('/puntos', requireAuth, (req, res) => {
    try {
        const { cliente_id, puntos, tipo, referencia } = req.body;
        if (!cliente_id || !puntos) {
            return res.status(400).json({ error: 'cliente_id y puntos son requeridos' });
        }

        const db = getDb();
        const negocioId = req.session.negocioId;

        // Upsert puntos_lealtad
        const existente = db.prepare('SELECT id, puntos FROM puntos_lealtad WHERE negocio_id = ? AND cliente_id = ?').get(negocioId, cliente_id);
        if (existente) {
            const nuevosPuntos = existente.puntos + puntos;
            const nivel = nuevosPuntos >= 5000 ? 'platino' : nuevosPuntos >= 2000 ? 'oro' : nuevosPuntos >= 500 ? 'plata' : 'bronce';
            db.prepare('UPDATE puntos_lealtad SET puntos = ?, nivel = ?, ultima_actividad = ? WHERE id = ?')
                .run(nuevosPuntos, nivel, getRDDateString(), existente.id);
        } else {
            const nivel = puntos >= 5000 ? 'platino' : puntos >= 2000 ? 'oro' : puntos >= 500 ? 'plata' : 'bronce';
            db.prepare('INSERT INTO puntos_lealtad (negocio_id, cliente_id, puntos, nivel, ultima_actividad) VALUES (?, ?, ?, ?, ?)')
                .run(negocioId, cliente_id, puntos, nivel, getRDDateString());
        }

        // Historial
        db.prepare(`
            INSERT INTO historial_puntos (negocio_id, cliente_id, puntos, tipo, referencia)
            VALUES (?, ?, ?, ?, ?)
        `).run(negocioId, cliente_id, puntos, tipo || 'ganado', referencia || null);

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al agregar puntos' });
    }
});

module.exports = router;
