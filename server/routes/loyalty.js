const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/loyalty — Resumen de lealtad
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

        const clientes = await db.collection('clientes').aggregate([
            { $match: { negocio_id: negocioId } },
            {
                $lookup: {
                    from: 'puntos_lealtad',
                    let: { clienteId: '$id' },
                    pipeline: [
                        { $match: { $expr: { $and: [{ $eq: ['$cliente_id', '$$clienteId'] }, { $eq: ['$negocio_id', negocioId] }] } } }
                    ],
                    as: 'pl'
                }
            },
            {
                $addFields: {
                    puntos: { $ifNull: [{ $arrayElemAt: ['$pl.puntos', 0] }, '$puntos'] },
                    nivel: { $ifNull: [{ $arrayElemAt: ['$pl.nivel', 0] }, { $ifNull: ['$nivel_lealtad', 'bronce'] }] },
                    ultima_actividad: { $arrayElemAt: ['$pl.ultima_actividad', 0] }
                }
            },
            {
                $lookup: {
                    from: 'ventas',
                    let: { clienteId: '$id' },
                    pipeline: [
                        { $match: { $expr: { $and: [{ $eq: ['$negocio_id', negocioId] }, { $eq: ['$cliente_id', '$$clienteId'] }] } } }
                    ],
                    as: 'ventas'
                }
            },
            {
                $addFields: {
                    total_compras: { $size: '$ventas' },
                    total_gastado: { $sum: '$ventas.total' }
                }
            },
            { $project: { ventas: 0, pl: 0 } },
            { $sort: { puntos: -1 } },
            { $limit: 50 }
        ]).toArray();

        const stats = await db.collection('puntos_lealtad').aggregate([
            { $match: { negocio_id: negocioId } },
            {
                $group: {
                    _id: '$nivel',
                    count: { $sum: 1 },
                    total_puntos: { $sum: { $ifNull: ['$puntos', 0] } }
                }
            },
            {
                $project: {
                    _id: 0,
                    nivel: '$_id',
                    count: 1,
                    total_puntos: 1
                }
            }
        ]).toArray();

        res.json({ clientes, stats });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener datos de lealtad' });
    }
});

// POST /api/loyalty/puntos — Agregar puntos a cliente
router.post('/puntos', requireAuth, async (req, res) => {
    try {
        const { cliente_id, puntos, tipo, referencia } = req.body;
        if (!cliente_id || !puntos) {
            return res.status(400).json({ error: 'cliente_id y puntos son requeridos' });
        }

        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

        // Upsert puntos_lealtad
        const existente = await db.collection('puntos_lealtad').findOne({ negocio_id: negocioId, cliente_id });
        if (existente) {
            const nuevosPuntos = existente.puntos + puntos;
            const nivel = nuevosPuntos >= 5000 ? 'platino' : nuevosPuntos >= 2000 ? 'oro' : nuevosPuntos >= 500 ? 'plata' : 'bronce';
            await db.collection('puntos_lealtad').updateOne(
                { _id: existente._id },
                { $set: { puntos: nuevosPuntos, nivel, ultima_actividad: getRDDateString() } }
            );
        } else {
            const nivel = puntos >= 5000 ? 'platino' : puntos >= 2000 ? 'oro' : puntos >= 500 ? 'plata' : 'bronce';
            await db.collection('puntos_lealtad').insertOne({
                negocio_id: negocioId,
                cliente_id,
                puntos,
                nivel,
                ultima_actividad: getRDDateString()
            });
        }

        // Historial
        await db.collection('historial_puntos').insertOne({
            negocio_id: negocioId,
            cliente_id,
            puntos,
            tipo: tipo || 'ganado',
            referencia: referencia || null
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al agregar puntos' });
    }
});

module.exports = router;
