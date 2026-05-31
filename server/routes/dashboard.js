const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/dashboard — Datos para el dashboard principal
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const hoy = getRDDateString();
        const mesActual = hoy.substring(0, 7); // YYYY-MM

        // Date ranges for MongoDB queries
        const hoyStart = new Date(`${hoy}T00:00:00.000Z`);
        const hoyEnd = new Date(`${hoy}T23:59:59.999Z`);
        const mesStart = new Date(`${mesActual}-01T00:00:00.000Z`);
        const mesEnd = new Date(`${mesActual}-31T23:59:59.999Z`);

        // Ventas hoy
        const ventasHoyAgg = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId, fecha: { $gte: hoyStart, $lte: hoyEnd } } },
            { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
        ]).toArray();
        const ventasHoy = ventasHoyAgg[0] || { total: 0, count: 0 };

        // Ventas mes
        const ventasMesAgg = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId, fecha: { $gte: mesStart, $lte: mesEnd } } },
            { $group: { _id: null, total: { $sum: '$total' } } }
        ]).toArray();
        const ventasMes = ventasMesAgg[0] || { total: 0 };

        // Citas hoy
        const citasHoyAgg = await db.collection('citas').aggregate([
            { $match: { negocio_id: negocioId, fecha: { $gte: hoyStart, $lte: hoyEnd }, estado: { $ne: 'cancelada' } } },
            { $group: { _id: null, total: { $sum: 1 }, pendientes: { $sum: { $cond: [{ $eq: ['$estado', 'pendiente'] }, 1, 0] } } } }
        ]).toArray();
        const citasHoy = citasHoyAgg[0] || { total: 0, pendientes: 0 };

        // Total clientes
        const totalClientes = await db.collection('clientes').countDocuments({ negocio_id: negocioId });

        // Clientes nuevos este mes
        const clientesNuevosMes = await db.collection('clientes').countDocuments({
            negocio_id: negocioId,
            fecha_registro: { $gte: mesStart, $lte: mesEnd }
        });

        // Total productos
        const totalProductos = await db.collection('productos').countDocuments({ negocio_id: negocioId });

        // Stock bajo
        const stockBajo = await db.collection('productos').countDocuments({
            negocio_id: negocioId,
            $expr: { $lte: ['$stock', '$stock_minimo'] },
            estado: 'activo'
        });

        const stockBajoList = await db.collection('productos').find({
            negocio_id: negocioId,
            $expr: { $lte: ['$stock', '$stock_minimo'] },
            estado: 'activo'
        }).sort({ stock: 1 }).limit(10).toArray();

        // ITBIS neto (cobrado - pagado) este mes
        const itbisCobradoAgg = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId, fecha: { $gte: mesStart, $lte: mesEnd } } },
            { $group: { _id: null, total: { $sum: '$itbis' } } }
        ]).toArray();
        const itbisCobradoMes = itbisCobradoAgg[0] || { total: 0 };

        const itbisPagadoAgg = await db.collection('estado_resultado_items').aggregate([
            { $match: { negocio_id: negocioId, tipo: 'gasto', fecha: { $gte: mesStart, $lte: mesEnd } } },
            { $group: { _id: null, total: { $sum: '$itbis_pagado' } } }
        ]).toArray();
        const itbisPagadoMes = itbisPagadoAgg[0] || { total: 0 };

        const itbisNeto = (itbisCobradoMes.total || 0) - (itbisPagadoMes.total || 0);

        // Comisiones pendientes
        const comisionesAgg = await db.collection('comisiones').aggregate([
            { $match: { negocio_id: negocioId, estado: 'pendiente' } },
            { $group: { _id: null, total: { $sum: '$monto_comision' }, count: { $sum: 1 }, user_ids: { $addToSet: '$user_id' } } }
        ]).toArray();
        const comisionesPendientes = comisionesAgg[0] || { total: 0, count: 0 };
        comisionesPendientes.count = comisionesAgg[0]?.user_ids?.length || 0;

        // Ultimas ventas (with $lookup for clientes)
        const ultimasVentas = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId } },
            { $lookup: { from: 'clientes', localField: 'cliente_id', foreignField: '_id', as: 'cliente' } },
            { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: -1 } },
            { $limit: 10 },
            { $project: { id: '$_id', total: 1, metodo_pago: 1, banco: 1, fecha: 1, cliente: '$cliente.nombre' } }
        ]).toArray();

        // Proximas citas (with $lookup for clientes and servicios)
        const proximasCitas = await db.collection('citas').aggregate([
            { $match: { negocio_id: negocioId, fecha: { $gte: hoyStart }, estado: 'pendiente' } },
            { $lookup: { from: 'clientes', localField: 'cliente_id', foreignField: '_id', as: 'cliente' } },
            { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'servicios', localField: 'servicio_id', foreignField: '_id', as: 'servicio' } },
            { $unwind: { path: '$servicio', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: 1, hora_inicio: 1 } },
            { $limit: 10 },
            { $project: { id: '$_id', fecha: 1, hora_inicio: 1, estado: 1, cliente: '$cliente.nombre', servicio: '$servicio.nombre' } }
        ]).toArray();

        // Resultado del mes
        const gastosMesAgg = await db.collection('estado_resultado_items').aggregate([
            { $match: { negocio_id: negocioId, tipo: 'gasto', fecha: { $gte: mesStart, $lte: mesEnd } } },
            { $group: { _id: null, total: { $sum: '$monto' } } }
        ]).toArray();
        const gastosMes = gastosMesAgg[0] || { total: 0 };
        const resultadoMes = (ventasMes.total || 0) - (gastosMes.total || 0);

        res.json({
            ventasHoy: ventasHoy.total || 0,
            ventasHoyCount: ventasHoy.count || 0,
            ventasMes: ventasMes.total || 0,
            citasHoy: citasHoy.total || 0,
            citasHoyPendientes: citasHoy.pendientes || 0,
            totalClientes,
            clientesNuevosMes,
            totalProductos,
            stockBajo,
            stockBajoList,
            itbisNeto,
            itbisCobradoMes: itbisCobradoMes.total || 0,
            itbisPagadoMes: itbisPagadoMes.total || 0,
            comisionesPendientes: comisionesPendientes.total || 0,
            comisionesCount: comisionesPendientes.count || 0,
            ultimasVentas,
            proximasCitas,
            resultadoMes
        });
    } catch (error) {
        console.error('Error en dashboard:', error);
        res.status(500).json({ error: 'Error al cargar el dashboard' });
    }
});

module.exports = router;
