const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/audit — Log de auditoria
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { tabla, user_id, desde, hasta, limit } = req.query;

        const filter = { negocio_id: negocioId };

        if (tabla) { filter.tabla = tabla; }
        if (user_id) { filter.user_id = user_id; }
        if (desde || hasta) {
            filter.fecha = {};
            if (desde) { filter.fecha.$gte = new Date(desde); }
            if (hasta) { filter.fecha.$lte = new Date(hasta + 'T23:59:59.999Z'); }
        }

        const logs = await db.collection('log_auditoria')
            .aggregate([
                { $match: filter },
                {
                    $lookup: {
                        from: 'usuarios',
                        localField: 'user_id',
                        foreignField: '_id',
                        as: 'usuarioDoc'
                    }
                },
                { $unwind: { path: '$usuarioDoc', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        id: '$_id',
                        accion: 1,
                        tabla: 1,
                        registro_id: 1,
                        detalle: 1,
                        ip: 1,
                        fecha: 1,
                        usuario: '$usuarioDoc.nombre'
                    }
                },
                { $sort: { fecha: -1 } },
                { $limit: parseInt(limit) || 100 }
            ])
            .toArray();

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const stats = await db.collection('log_auditoria')
            .aggregate([
                {
                    $match: {
                        negocio_id: negocioId,
                        fecha: { $gte: thirtyDaysAgo }
                    }
                },
                { $group: { _id: '$accion', count: { $sum: 1 } } },
                { $project: { accion: '$_id', count: 1, _id: 0 } },
                { $sort: { count: -1 } }
            ])
            .toArray();

        res.json({ logs, stats });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener log de auditoria' });
    }
});

// POST /api/audit — Registrar accion (usado internamente)
router.post('/', requireAuth, async (req, res) => {
    try {
        const { accion, tabla, registro_id, detalle } = req.body;
        const db = getDb();

        await db.collection('log_auditoria').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            user_id: req.session.userId,
            accion,
            tabla: tabla || null,
            registro_id: registro_id || null,
            detalle: detalle || null,
            ip: req.ip,
            user_agent: req.headers['user-agent'],
            fecha: new Date()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al registrar auditoria' });
    }
});

module.exports = router;
