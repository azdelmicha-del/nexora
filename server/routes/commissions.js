const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');


const router = express.Router();

// GET /api/commissions — Resumen de comisiones por empleado
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta, user_id } = req.query;

        const match = { negocio_id: negocioId };
        if (desde) match.fecha = { ...match.fecha, $gte: new Date(desde) };
        if (hasta) match.fecha = { ...match.fecha, $lte: new Date(hasta + 'T23:59:59.999Z') };
        if (user_id) match.user_id = user_id;

        // Comisiones por empleado
        const porEmpleado = await db.collection('comisiones').aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuario'
                }
            },
            { $unwind: '$usuario' },
            {
                $group: {
                    _id: { user_id: '$user_id', nombre: '$usuario.nombre', porcentaje: '$porcentaje' },
                    total_ventas: { $sum: 1 },
                    total_ventas_monto: { $sum: '$monto_base' },
                    porcentaje: { $first: '$porcentaje' },
                    total_comision: { $sum: '$monto_comision' },
                    comision_pendiente: {
                        $sum: { $cond: [{ $eq: ['$estado', 'pendiente'] }, '$monto_comision', 0] }
                    },
                    comision_pagada: {
                        $sum: { $cond: [{ $eq: ['$estado', 'pagada'] }, '$monto_comision', 0] }
                    }
                }
            },
            {
                $project: {
                    user_id: '$_id.user_id',
                    nombre: '$_id.nombre',
                    total_ventas: 1,
                    total_ventas_monto: 1,
                    porcentaje: 1,
                    total_comision: 1,
                    comision_pendiente: 1,
                    comision_pagada: 1,
                    _id: 0
                }
            },
            { $sort: { total_comision: -1 } }
        ]).toArray();

        // Comisiones individuales
        const comisiones = await db.collection('comisiones').aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuario'
                }
            },
            { $unwind: '$usuario' },
            {
                $lookup: {
                    from: 'ventas',
                    localField: 'venta_id',
                    foreignField: '_id',
                    as: 'venta'
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    negocio_id: 1,
                    user_id: 1,
                    venta_id: 1,
                    detalle_id: 1,
                    monto_base: 1,
                    porcentaje: 1,
                    monto_comision: 1,
                    estado: 1,
                    fecha: 1,
                    empleado: '$usuario.nombre',
                    secuencia_ecf: { $arrayElemAt: ['$venta.secuencia_ecf', 0] },
                    _id: 0
                }
            },
            { $sort: { fecha: -1 } },
            { $limit: 100 }
        ]).toArray();

        res.json({ porEmpleado, comisiones });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener comisiones' });
    }
});

// POST /api/commissions/calcular — Calcular comisiones de un periodo
// Comision por servicio: cada servicio tiene su propio %
// Se calcula por linea de venta_detalles, no por venta total
router.post('/calcular', requireAdmin, async (req, res) => {
    try {
        const { desde, hasta } = req.body;
        if (!desde || !hasta) {
            return res.status(400).json({ error: 'desde y hasta son requeridos' });
        }

        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

        const fechaMatch = {
            $gte: new Date(desde),
            $lte: new Date(hasta + 'T23:59:59.999Z')
        };

        // Comisiones por servicio (usa comision_porcentaje del servicio)
        const lineasServicios = await db.collection('venta_detalles').aggregate([
            { $match: { tipo_item: 'servicio' } },
            {
                $lookup: {
                    from: 'ventas',
                    localField: 'venta_id',
                    foreignField: '_id',
                    as: 'venta'
                }
            },
            { $unwind: '$venta' },
            {
                $match: {
                    'venta.negocio_id': negocioId,
                    'venta.fecha': fechaMatch,
                    'venta.metodo_pago': { $ne: 'nota' }
                }
            },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'venta.user_id',
                    foreignField: '_id',
                    as: 'usuario'
                }
            },
            { $unwind: '$usuario' },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicio'
                }
            },
            { $unwind: '$servicio' },
            { $match: { 'servicio.comision_porcentaje': { $gt: 0 } } },
            {
                $project: {
                    detalle_id: '$_id',
                    venta_id: 1,
                    servicio_id: 1,
                    cantidad: 1,
                    precio: 1,
                    subtotal: 1,
                    tipo_item: 1,
                    user_id: '$venta.user_id',
                    fecha: '$venta.fecha',
                    empleado: '$usuario.nombre',
                    comision_porcentaje: '$usuario.comision_porcentaje',
                    servicio: '$servicio.nombre',
                    servicio_comision: '$servicio.comision_porcentaje'
                }
            }
        ]).toArray();

        // Comisiones por menu items (usa comision_porcentaje del empleado)
        const lineasMenu = await db.collection('venta_detalles').aggregate([
            { $match: { tipo_item: 'menu' } },
            {
                $lookup: {
                    from: 'ventas',
                    localField: 'venta_id',
                    foreignField: '_id',
                    as: 'venta'
                }
            },
            { $unwind: '$venta' },
            {
                $match: {
                    'venta.negocio_id': negocioId,
                    'venta.fecha': fechaMatch,
                    'venta.metodo_pago': { $ne: 'nota' }
                }
            },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'venta.user_id',
                    foreignField: '_id',
                    as: 'usuario'
                }
            },
            { $unwind: '$usuario' },
            {
                $lookup: {
                    from: 'menu_items',
                    localField: 'menu_item_id',
                    foreignField: '_id',
                    as: 'menuItem'
                }
            },
            { $unwind: '$menuItem' },
            { $match: { 'usuario.comision_porcentaje': { $gt: 0 } } },
            {
                $project: {
                    detalle_id: '$_id',
                    venta_id: 1,
                    menu_item_id: 1,
                    cantidad: 1,
                    precio: 1,
                    subtotal: 1,
                    tipo_item: 1,
                    user_id: '$venta.user_id',
                    fecha: '$venta.fecha',
                    empleado: '$usuario.nombre',
                    comision_porcentaje: '$usuario.comision_porcentaje',
                    servicio: '$menuItem.nombre'
                }
            }
        ]).toArray();

        const lineas = [...lineasServicios, ...lineasMenu];

        let creadas = 0;
        for (const l of lineas) {
            const porcentaje = l.tipo_item === 'servicio'
                ? (l.servicio_comision || l.comision_porcentaje || 0)
                : (l.comision_porcentaje || 0);
            if (porcentaje <= 0) continue;

            const montoComision = Math.round((l.subtotal * porcentaje / 100) * 100) / 100;
            if (montoComision <= 0) continue;

            const existente = await db.collection('comisiones').findOne({ detalle_id: l.detalle_id });
            if (existente) continue;

            await db.collection('comisiones').insertOne({
                negocio_id: negocioId,
                user_id: l.user_id,
                venta_id: l.venta_id,
                detalle_id: l.detalle_id,
                monto_base: l.subtotal,
                porcentaje,
                monto_comision: montoComision,
                fecha: l.fecha,
                estado: 'pendiente'
            });

            creadas++;
        }

        res.json({ success: true, comisiones_creadas: creadas, total_lineas: lineas.length });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al calcular comisiones' });
    }
});

// PUT /api/commissions/:id/pagar — Marcar comision como pagada
router.put('/:id/pagar', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const comision = await db.collection('comisiones').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: negocioId
        });
        if (!comision) {
            return res.status(404).json({ error: 'Comision no encontrada' });
        }

        await db.collection('comisiones').updateOne(
            { _id: normalizeId(req.params.id), negocio_id: negocioId },
            { $set: { estado: 'pagada' } }
        );
        res.json({ success: true, message: 'Comision marcada como pagada' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar comision' });
    }
});

// PUT /api/commissions/pagar-todas — Marcar todas las comisiones de un empleado como pagadas
router.put('/pagar-todas', requireAdmin, async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) {
            return res.status(400).json({ error: 'user_id es requerido' });
        }

        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const result = await db.collection('comisiones').updateMany(
            { user_id: user_id, estado: 'pendiente', negocio_id: negocioId },
            { $set: { estado: 'pagada' } }
        );

        res.json({ success: true, pagadas: result.modifiedCount });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al pagar comisiones' });
    }
});

module.exports = router;
