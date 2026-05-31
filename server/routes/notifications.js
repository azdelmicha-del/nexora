const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { sin_leer } = req.query;

        const filter = { negocio_id: normalizeId(req.session.negocioId) };

        if (sin_leer === 'true') {
            filter.leida = 0;
        }

        const notificaciones = await db.collection('notificaciones')
            .find(filter)
            .sort({ fecha: -1 })
            .limit(50)
            .toArray();

        const result = notificaciones.map(n => ({
            id: n._id,
            tipo: n.tipo,
            mensaje: n.mensaje,
            referencia_id: n.referencia_id,
            leida: n.leida,
            fecha: n.fecha
        }));

        res.json(result);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

router.get('/contador', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const total = await db.collection('notificaciones').countDocuments({
            negocio_id: normalizeId(req.session.negocioId),
            leida: 0
        });
        res.json({ total });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

router.put('/:id/leer', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const notificacionId = normalizeId(req.params.id);

        const notificacion = await db.collection('notificaciones').findOne({
            _id: notificacionId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!notificacion) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }

        await db.collection('notificaciones').updateOne(
            { _id: notificacionId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { leida: 1 } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al marcar como leída' });
    }
});

router.put('/leer-todas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        await db.collection('notificaciones').updateMany(
            { negocio_id: normalizeId(req.session.negocioId), leida: 0 },
            { $set: { leida: 1 } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const notificacionId = normalizeId(req.params.id);

        const notificacion = await db.collection('notificaciones').findOne({
            _id: notificacionId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!notificacion) {
            return res.status(404).json({ error: 'Notificación no encontrada' });
        }

        await db.collection('notificaciones').deleteOne({
            _id: notificacionId,
            negocio_id: normalizeId(req.session.negocioId)
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar' });
    }
});

module.exports = router;
