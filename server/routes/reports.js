const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRDDateString, getRDDate, getRDTimestamp } = require('../utils/timezone');


const router = express.Router();

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || !ISO_DATE_REGEX.test(dateStr)) {
        return false;
    }
    const parsed = new Date(`${dateStr}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(dateStr);
}

function validateDateRangeOrRespond(res, desde, hasta) {
    if (desde && !isValidISODate(desde)) {
        res.status(400).json({ error: 'Parametro "desde" invalido. Formato esperado: YYYY-MM-DD' });
        return false;
    }
    if (hasta && !isValidISODate(hasta)) {
        res.status(400).json({ error: 'Parametro "hasta" invalido. Formato esperado: YYYY-MM-DD' });
        return false;
    }
    if (desde && hasta && desde > hasta) {
        res.status(400).json({ error: 'Rango de fechas invalido: "desde" no puede ser mayor que "hasta"' });
        return false;
    }
    return true;
}

function parseMonthYearOrRespond(res, mes, anio, now) {
    const mesNum = mes ? Number.parseInt(mes, 10) : (now.getMonth() + 1);
    const anioNum = anio ? Number.parseInt(anio, 10) : now.getFullYear();

    if (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12) {
        res.status(400).json({ error: 'Parametro "mes" invalido. Debe ser un numero entre 1 y 12' });
        return null;
    }
    if (!Number.isInteger(anioNum) || anioNum < 2000 || anioNum > 2100) {
        res.status(400).json({ error: 'Parametro "anio" invalido. Debe ser un numero entre 2000 y 2100' });
        return null;
    }

    return { mes: mesNum, anio: anioNum };
}

function dateRangeFilter(field, desde, hasta) {
    const filter = {};
    if (desde) {
        filter.$gte = new Date(`${desde}T00:00:00.000Z`);
    }
    if (hasta) {
        filter.$lte = new Date(`${hasta}T23:59:59.999Z`);
    }
    return Object.keys(filter).length > 0 ? { [field]: filter } : {};
}

function monthYearFilter(field, mes, anio) {
    const start = new Date(anio, mes - 1, 1);
    const end = new Date(anio, mes, 0, 23, 59, 59, 999);
    return { [field]: { $gte: start, $lte: end } };
}

function mapId(doc) {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id.toString(), ...rest };
}

function mapIdList(docs) {
    return docs.map(mapId);
}

router.get('/ventas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const baseFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) };

        const ventasSummary = await db.collection('ventas').aggregate([
            { $match: baseFilter },
            {
                $group: {
                    _id: null,
                    total_ventas: { $sum: 1 },
                    monto_total: { $sum: { $ifNull: ['$total', 0] } },
                    subtotal_total: { $sum: { $ifNull: ['$subtotal', 0] } },
                    itbis_total: { $sum: { $ifNull: ['$itbis', 0] } },
                    descuento_total: { $sum: { $ifNull: ['$descuento', 0] } },
                    promedio_venta: { $avg: { $ifNull: ['$total', 0] } }
                }
            }
        ]).toArray();

        const resumen = ventasSummary[0] || {
            total_ventas: 0, monto_total: 0, subtotal_total: 0,
            itbis_total: 0, descuento_total: 0, promedio_venta: 0
        };

        const ventaIds = await db.collection('ventas').find(baseFilter).project({ _id: 1 }).toArray();
        const ventaIdList = ventaIds.map(v => v._id);

        const itbisDetallesAgg = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList } } },
            {
                $group: {
                    _id: null,
                    itbis_real: { $sum: { $ifNull: ['$itbis_monto', 0] } }
                }
            }
        ]).toArray();

        const itbisDetalles = itbisDetallesAgg[0] || { itbis_real: 0 };

        resumen.itbis_cobrado_real = Math.max(
            itbisDetalles.itbis_real || 0,
            resumen.itbis_total || 0
        );

        const porMetodo = await db.collection('ventas').aggregate([
            { $match: baseFilter },
            {
                $group: {
                    _id: '$metodo_pago',
                    cantidad: { $sum: 1 },
                    monto: { $sum: { $ifNull: ['$total', 0] } }
                }
            },
            { $project: { metodo_pago: '$_id', cantidad: 1, monto: 1, _id: 0 } }
        ]).toArray();

        const porDia = await db.collection('ventas').aggregate([
            { $match: baseFilter },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } },
                    cantidad: { $sum: 1 },
                    monto: { $sum: { $ifNull: ['$total', 0] } }
                }
            },
            { $project: { fecha: '$_id', cantidad: 1, monto: 1, _id: 0 } },
            { $sort: { fecha: -1 } },
            { $limit: 30 }
        ]).toArray();

        const ultimasVentas = await db.collection('ventas').aggregate([
            { $match: baseFilter },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: -1 } },
            { $limit: 20 },
            {
                $project: {
                    id: { $toString: '$_id' }, total: 1, subtotal: 1, itbis: 1, descuento: 1,
                    metodo_pago: 1, banco: 1, fecha: 1, secuencia_ecf: 1,
                    cliente: { $ifNull: ['$clienteDoc.nombre', null] }
                }
            }
        ]).toArray();

        res.json({
            resumen,
            porMetodo,
            porDia,
            ultimasVentas,
            caja_cerrada: false
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de ventas' });
    }
});

router.get('/fiscal', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const ventasFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) };
        const egresosFilter = { negocio_id: negocioId, tipo: 'gasto', ...dateRangeFilter('fecha', desde, hasta) };

        const ventaIds = await db.collection('ventas').find(ventasFilter).project({ _id: 1 }).toArray();
        const ventaIdList = ventaIds.map(v => v._id);

        const itbisDetallesAgg = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$itbis_monto', 0] } } } }
        ]).toArray();

        const itbisVentasAgg = await db.collection('ventas').aggregate([
            { $match: ventasFilter },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$itbis', 0] } } } }
        ]).toArray();

        const itbisDetalles = itbisDetallesAgg[0] || { total: 0 };
        const itbisVentas = itbisVentasAgg[0] || { total: 0 };

        const itbisCobrado = Math.max(
            parseFloat(itbisDetalles.total) || 0,
            parseFloat(itbisVentas.total) || 0
        );

        const egresosSummary = await db.collection('estado_resultado_items').aggregate([
            { $match: egresosFilter },
            {
                $group: {
                    _id: null,
                    total_itbis_formulario: { $sum: { $ifNull: ['$itbis', 0] } },
                    total_itbis_ncf: { $sum: { $ifNull: ['$itbis_pagado', 0] } },
                    total_egresos: { $sum: 1 }
                }
            }
        ]).toArray();

        const itbisEgresos = egresosSummary[0] || { total_itbis_formulario: 0, total_itbis_ncf: 0, total_egresos: 0 };

        const itbisPorEgresoRaw = await db.collection('estado_resultado_items').find(egresosFilter)
            .sort({ fecha: -1 }).toArray();

        const itbisPorEgreso = itbisPorEgresoRaw.map(e => {
            const doc = mapId(e);
            doc.itbis_efectivo = Math.max(parseFloat(doc.itbis) || 0, parseFloat(doc.itbis_pagado) || 0);
            return doc;
        });

        const itbisPagado = itbisPorEgreso.reduce(
            (sum, e) => sum + (parseFloat(e.itbis_efectivo) || 0), 0
        );

        const servicioIds = await db.collection('servicios').find({ negocio_id: negocioId }).project({ _id: 1, itbis_tasa: 1 }).toArray();
        const servicioIdMap = {};
        servicioIds.forEach(s => { servicioIdMap[s._id.toString()] = s.itbis_tasa; });

        const porTasa = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList }, servicio_id: { $exists: true } } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioDoc'
                }
            },
            { $unwind: { path: '$servicioDoc', preserveNullAndEmptyArrays: true } },
            { $match: { 'servicioDoc.negocio_id': negocioId } },
            {
                $group: {
                    _id: '$servicioDoc.itbis_tasa',
                    veces: { $sum: 1 },
                    subtotal_total: { $sum: { $ifNull: ['$subtotal', 0] } },
                    itbis_total: { $sum: { $ifNull: ['$itbis_monto', 0] } }
                }
            },
            { $project: { itbis_tasa: '$_id', veces: 1, subtotal_total: 1, itbis_total: 1, _id: 0 } },
            { $sort: { itbis_tasa: -1 } }
        ]).toArray();

        const ventasDetalle = await db.collection('ventas').aggregate([
            { $match: ventasFilter },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'venta_detalles',
                    localField: '_id',
                    foreignField: 'venta_id',
                    as: 'detalles'
                }
            },
            {
                $group: {
                    _id: '$_id',
                    fecha: { $first: '$fecha' },
                    metodo_pago: { $first: '$metodo_pago' },
                    banco: { $first: '$banco' },
                    total: { $first: '$total' },
                    subtotal: { $first: '$subtotal' },
                    itbis: { $first: '$itbis' },
                    descuento: { $first: '$descuento' },
                    secuencia_ecf: { $first: '$secuencia_ecf' },
                    cliente: { $first: '$clienteDoc.nombre' },
                    itbis_monto_real: { $sum: { $ifNull: ['$detalles.itbis_monto', 0] } }
                }
            },
            { $sort: { fecha: -1 } },
            { $limit: 50 },
            {
                $project: {
                    id: { $toString: '$_id' }, fecha: 1, metodo_pago: 1, banco: 1, total: 1,
                    subtotal: 1, itbis: 1, descuento: 1, secuencia_ecf: 1, cliente: 1, itbis_monto_real: 1
                }
            }
        ]).toArray();

        res.json({
            itbisCobrado: Math.round(itbisCobrado * 100) / 100,
            itbisPagado: Math.round(itbisPagado * 100) / 100,
            itbisNeto: Math.round((itbisCobrado - itbisPagado) * 100) / 100,
            porTasa,
            egresos: itbisPorEgreso,
            ventas: ventasDetalle,
            meta: {
                itbis_de_detalles: parseFloat(itbisDetalles.total) || 0,
                itbis_de_ventas: parseFloat(itbisVentas.total) || 0,
                itbis_formulario: parseFloat(itbisEgresos.total_itbis_formulario) || 0,
                itbis_ncf: parseFloat(itbisEgresos.total_itbis_ncf) || 0,
                total_egresos: itbisEgresos.total_egresos
            }
        });
    } catch (error) {
        console.error('Error en reporte fiscal:', error);
        res.status(500).json({ error: 'Error al obtener reporte fiscal: ' + error.message });
    }
});

router.get('/606', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { mes, anio } = req.query;

        const now = getRDDate();
        const monthYear = parseMonthYearOrRespond(res, mes, anio, now);
        if (!monthYear) {
            return;
        }
        const mesFilt = monthYear.mes;
        const anioFilt = monthYear.anio;

        const egresos = await db.collection('estado_resultado_items').find({
            negocio_id: negocioId,
            tipo: 'gasto',
            ncf_suplidor: { $ne: null },
            ...monthYearFilter('fecha', mesFilt, anioFilt)
        }).sort({ fecha: 1 }).toArray();

        const registros = egresos.map(e => {
            const doc = mapId(e);
            return {
                NCF_Documento: doc.ncf_suplidor,
                Tipo_Gasto: { insumo: '01', fijo: '02', personal: '03' }[doc.tipo_gasto] || '04',
                Fecha_Comprobante: doc.fecha,
                RNC_Suplidor: doc.ncf_suplidor || 'N/A',
                Detalle: doc.descripcion,
                Monto_Sin_ITBIS: doc.subtotal,
                ITBIS: doc.itbis || 0,
                Descuento: doc.descuento || 0,
                Total: doc.monto
            };
        });

        res.json({
            tipo: '606',
            mes: mesFilt,
            anio: anioFilt,
            registros,
            totales: {
                monto_sin_itbis: registros.reduce((s, e) => s + (e.Monto_Sin_ITBIS || 0), 0),
                itbis: registros.reduce((s, e) => s + (e.ITBIS || 0), 0),
                descuento: registros.reduce((s, e) => s + (e.Descuento || 0), 0),
                total: registros.reduce((s, e) => s + (e.Total || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error en 606:', error);
        res.status(500).json({ error: 'Error al generar reporte 606' });
    }
});

router.get('/607', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { mes, anio } = req.query;

        const now = getRDDate();
        const monthYear = parseMonthYearOrRespond(res, mes, anio, now);
        if (!monthYear) {
            return;
        }
        const mesFilt = monthYear.mes;
        const anioFilt = monthYear.anio;

        const ventas = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: negocioId,
                    estado_dgii: { $ne: 'anulada' },
                    ...monthYearFilter('fecha', mesFilt, anioFilt)
                }
            },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: 1 } },
            {
                $project: {
                    NCF: '$secuencia_ecf',
                    Fecha_Comprobante: '$fecha',
                    RNC_Cedula: { $ifNull: ['$clienteDoc.documento', ''] },
                    Nombre_Cliente: { $ifNull: ['$clienteDoc.nombre', 'CONSUMIDOR FINAL'] },
                    Monto_Sin_ITBIS: '$subtotal',
                    ITBIS: { $ifNull: ['$itbis', 0] },
                    Descuento: { $ifNull: ['$descuento', 0] },
                    Total: '$total',
                    Tipo_Ingresos: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$tipo_ecf', '31'] }, then: '01' },
                                { case: { $eq: ['$tipo_ecf', '32'] }, then: '02' },
                                { case: { $eq: ['$tipo_ecf', '33'] }, then: '03' },
                                { case: { $eq: ['$tipo_ecf', '34'] }, then: '04' }
                            ],
                            default: '02'
                        }
                    }
                }
            }
        ]).toArray();

        res.json({
            tipo: '607',
            mes: mesFilt,
            anio: anioFilt,
            registros: ventas,
            totales: {
                monto_sin_itbis: ventas.reduce((s, v) => s + (v.Monto_Sin_ITBIS || 0), 0),
                itbis: ventas.reduce((s, v) => s + (v.ITBIS || 0), 0),
                descuento: ventas.reduce((s, v) => s + (v.Descuento || 0), 0),
                total: ventas.reduce((s, v) => s + (v.Total || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error en 607:', error);
        res.status(500).json({ error: 'Error al generar reporte 607' });
    }
});

router.get('/export/ventas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const ventas = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuarioDoc'
                }
            },
            { $unwind: { path: '$usuarioDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: -1 } },
            {
                $project: {
                    id: { $toString: '$_id' }, fecha: 1, total: 1, subtotal: 1, itbis: 1, descuento: 1,
                    metodo_pago: 1, banco: 1, tipo_ecf: 1, secuencia_ecf: 1,
                    cliente: { $ifNull: ['$clienteDoc.nombre', null] },
                    cliente_doc: { $ifNull: ['$clienteDoc.documento', null] },
                    vendedor: { $ifNull: ['$usuarioDoc.nombre', null] }
                }
            }
        ]).toArray();

        const headers = ['ID','Fecha','Cliente','Documento','Vendedor','Metodo Pago','Banco','Tipo ECF','NCF','Subtotal','ITBIS','Descuento','Total'];
        const rows = ventas.map(v => [
            v.id, v.fecha, v.cliente || 'Consumidor Final', v.cliente_doc || '',
            v.vendedor || '', v.metodo_pago, v.banco || '', v.tipo_ecf, v.secuencia_ecf || '',
            v.subtotal, v.itbis, v.descuento, v.total
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ventas_${desde || 'todo'}_${hasta || 'hoy'}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export CSV:', error);
        res.status(500).json({ error: 'Error al exportar' });
    }
});

router.get('/export/egresos', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const egresos = await db.collection('estado_resultado_items').find({
            negocio_id: negocioId,
            tipo: 'gasto',
            ...dateRangeFilter('fecha', desde, hasta)
        }).sort({ fecha: -1 }).toArray();

        const headers = ['ID','Fecha','Categoria','Subtipo','Descripcion','Subtotal','ITBIS','Descuento','Total','Metodo Pago','NCF Suplidor','ITBIS Pagado','Tipo Gasto','Notas'];
        const rows = egresos.map(e => {
            const doc = mapId(e);
            return [
                doc.id, doc.fecha, doc.categoria, doc.subtipo || '', doc.descripcion,
                doc.subtotal, doc.itbis, doc.descuento, doc.monto, doc.metodo_pago,
                doc.ncf_suplidor || '', doc.itbis_pagado || 0, doc.tipo_gasto || '', doc.notas || ''
            ];
        });

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="egresos_${desde || 'todo'}_${hasta || 'hoy'}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export CSV:', error);
        res.status(500).json({ error: 'Error al exportar' });
    }
});

router.get('/export/606', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { mes, anio } = req.query;
        const now = getRDDate();
        const monthYear = parseMonthYearOrRespond(res, mes, anio, now);
        if (!monthYear) {
            return;
        }
        const mesFilt = monthYear.mes;
        const anioFilt = monthYear.anio;

        const egresos = await db.collection('estado_resultado_items').find({
            negocio_id: negocioId,
            tipo: 'gasto',
            ncf_suplidor: { $ne: null },
            ...monthYearFilter('fecha', mesFilt, anioFilt)
        }).sort({ fecha: 1 }).toArray();

        const headers = ['NCF_Documento','Tipo_Gasto','Fecha_Comprobante','Detalle','Monto_Sin_ITBIS','ITBIS','Descuento','Total'];
        const rows = egresos.map(e => {
            const doc = mapId(e);
            return [
                doc.ncf_suplidor,
                { insumo: '01', fijo: '02', personal: '03' }[doc.tipo_gasto] || '04',
                doc.fecha, doc.descripcion, doc.subtotal, doc.itbis, doc.descuento, doc.monto
            ];
        });

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="606_${anioFilt}_${String(mesFilt).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export 606:', error);
        res.status(500).json({ error: 'Error al exportar 606' });
    }
});

router.get('/export/607', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { mes, anio } = req.query;
        const now = getRDDate();
        const monthYear = parseMonthYearOrRespond(res, mes, anio, now);
        if (!monthYear) {
            return;
        }
        const mesFilt = monthYear.mes;
        const anioFilt = monthYear.anio;

        const ventas = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: negocioId,
                    estado_dgii: { $ne: 'anulada' },
                    ...monthYearFilter('fecha', mesFilt, anioFilt)
                }
            },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: 1 } },
            {
                $project: {
                    secuencia_ecf: 1, fecha: 1, subtotal: 1, itbis: 1, descuento: 1, total: 1, tipo_ecf: 1,
                    documento: { $ifNull: ['$clienteDoc.documento', null] },
                    nombre: { $ifNull: ['$clienteDoc.nombre', null] }
                }
            }
        ]).toArray();

        const headers = ['NCF','Fecha_Comprobante','RNC_Cedula','Nombre_Cliente','Monto_Sin_ITBIS','ITBIS','Descuento','Total','Tipo_Ingresos'];
        const rows = ventas.map(v => [
            v.secuencia_ecf, v.fecha, v.documento || '', v.nombre || 'CONSUMIDOR FINAL',
            v.subtotal, v.itbis, v.descuento, v.total,
            { '31': '01', '32': '02', '33': '03', '34': '04' }[v.tipo_ecf] || '02'
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="607_${anioFilt}_${String(mesFilt).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export 607:', error);
        res.status(500).json({ error: 'Error al exportar 607' });
    }
});

router.get('/servicios', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const ventasFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) };
        const ventaIds = await db.collection('ventas').find(ventasFilter).project({ _id: 1 }).toArray();
        const ventaIdList = ventaIds.map(v => v._id);

        const topServicios = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList }, servicio_id: { $exists: true } } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioDoc'
                }
            },
            { $unwind: '$servicioDoc' },
            { $match: { 'servicioDoc.negocio_id': negocioId } },
            {
                $group: {
                    _id: { id: '$servicioDoc._id', nombre: '$servicioDoc.nombre', precio: '$servicioDoc.precio' },
                    veces_vendido: { $sum: 1 },
                    ingreso_total: { $sum: { $ifNull: ['$subtotal', 0] } }
                }
            },
            { $project: { id: { $toString: '$_id.id' }, nombre: '$_id.nombre', precio: '$_id.precio', veces_vendido: 1, ingreso_total: 1, _id: 0 } },
            { $sort: { veces_vendido: -1 } },
            { $limit: 20 }
        ]).toArray();

        const porCategoria = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList }, servicio_id: { $exists: true } } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioDoc'
                }
            },
            { $unwind: '$servicioDoc' },
            { $match: { 'servicioDoc.negocio_id': negocioId } },
            {
                $lookup: {
                    from: 'categorias',
                    localField: 'servicioDoc.categoria_id',
                    foreignField: '_id',
                    as: 'categoriaDoc'
                }
            },
            { $unwind: { path: '$categoriaDoc', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { id: '$categoriaDoc._id', nombre: '$categoriaDoc.nombre' },
                    veces_vendido: { $sum: 1 },
                    ingreso_total: { $sum: { $ifNull: ['$subtotal', 0] } }
                }
            },
            { $project: { categoria: { $ifNull: ['$_id.nombre', 'Sin categoría'] }, veces_vendido: 1, ingreso_total: 1, _id: 0 } },
            { $sort: { ingreso_total: -1 } }
        ]).toArray();

        const allServicioIds = await db.collection('servicios').find({ negocio_id: negocioId }).project({ _id: 1 }).toArray();
        const allServicioIdList = allServicioIds.map(s => s._id);

        const totalServiciosAgg = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: { $in: ventaIdList }, servicio_id: { $in: allServicioIdList } } },
            {
                $group: {
                    _id: null,
                    servicios_vendidos: { $addToSet: '$servicio_id' },
                    ingreso_total: { $sum: { $ifNull: ['$subtotal', 0] } }
                }
            },
            {
                $project: {
                    servicios_vendidos: { $size: '$servicios_vendidos' },
                    ingreso_total: 1,
                    _id: 0
                }
            }
        ]).toArray();

        const totalServicios = totalServiciosAgg[0] || { servicios_vendidos: 0, ingreso_total: 0 };

        res.json({
            topServicios,
            porCategoria,
            totalServicios,
            caja_cerrada: false
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de servicios' });
    }
});

router.get('/clientes', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const hace30dias = getRDDate();
        hace30dias.setDate(hace30dias.getDate() - 30);
        const fechaUltimos30Dias = getRDDateString(hace30dias);

        const clientesFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha_registro', desde, hasta) };
        const clientes = await db.collection('clientes').find(clientesFilter).toArray();

        const clientesConCompras = await db.collection('ventas').aggregate([
            { $match: { negocio_id: negocioId, cliente_id: { $ne: null } } },
            { $group: { _id: '$cliente_id' } }
        ]).toArray();
        const clientesConComprasSet = new Set(clientesConCompras.map(c => c._id.toString()));

        const nuevosMes = clientes.filter(c => {
            const d = new Date(c.fecha_registro);
            return d >= new Date(`${fechaUltimos30Dias}T00:00:00.000Z`);
        }).length;

        const conCompras = clientes.filter(c => clientesConComprasSet.has(c._id.toString())).length;

        const resumen = {
            total_clientes: clientes.length,
            nuevos_mes: nuevosMes,
            con_compras: conCompras
        };

        const ventasFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) };

        const dateExprs = [];
        if (desde) dateExprs.push({ $gte: ['$fecha', new Date(desde + 'T00:00:00.000Z')] });
        if (hasta) dateExprs.push({ $lte: ['$fecha', new Date(hasta + 'T23:59:59.999Z')] });

        const masFrecuentes = await db.collection('clientes').aggregate([
            { $match: { negocio_id: negocioId } },
            {
                $lookup: {
                    from: 'ventas',
                    let: { clienteId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $and: [
                            { $eq: ['$cliente_id', '$$clienteId'] },
                            { $eq: ['$negocio_id', negocioId] },
                            ...(dateExprs.length > 0 ? [{ $and: dateExprs }] : [])
                        ]} } },
                        { $group: { _id: null, total_compras: { $sum: 1 }, total_gastado: { $sum: { $ifNull: ['$total', 0] } } } }
                    ],
                    as: 'ventasData'
                }
            },
            { $unwind: { path: '$ventasData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: { $toString: '$_id' }, nombre: 1, telefono: 1,
                    total_compras: { $ifNull: ['$ventasData.total_compras', 0] },
                    total_gastado: { $ifNull: ['$ventasData.total_gastado', 0] }
                }
            },
            { $sort: { total_compras: -1 } },
            { $limit: 10 }
        ]).toArray();

        const ultimosRegistrados = await db.collection('clientes').aggregate([
            { $match: { negocio_id: negocioId, ...dateRangeFilter('fecha_registro', desde, hasta) } },
            {
                $lookup: {
                    from: 'ventas',
                    let: { clienteId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $and: [
                            { $eq: ['$cliente_id', '$$clienteId'] },
                            { $eq: ['$negocio_id', negocioId] },
                            ...(dateExprs.length > 0 ? [{ $and: dateExprs }] : [])
                        ]} } },
                        { $count: 'total_compras' }
                    ],
                    as: 'ventasData'
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' }, nombre: 1, telefono: 1, fecha_registro: 1,
                    total_compras: { $ifNull: [{ $first: '$ventasData.total_compras' }, 0] }
                }
            },
            { $sort: { fecha_registro: -1 } },
            { $limit: 10 }
        ]).toArray();

        res.json({
            resumen,
            masFrecuentes,
            ultimosRegistrados
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de clientes' });
    }
});

router.get('/citas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) {
            return;
        }

        const citasFilter = { negocio_id: negocioId, ...dateRangeFilter('fecha', desde, hasta) };

        const resumenAgg = await db.collection('citas').aggregate([
            { $match: citasFilter },
            {
                $group: {
                    _id: null,
                    total_citas: { $sum: 1 },
                    finalizadas: { $sum: { $cond: [{ $eq: ['$estado', 'finalizada'] }, 1, 0] } },
                    canceladas: { $sum: { $cond: [{ $eq: ['$estado', 'cancelada'] }, 1, 0] } },
                    pendientes: { $sum: { $cond: [{ $in: ['$estado', ['pendiente', 'confirmada']] }, 1, 0] } }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total_citas: 0, finalizadas: 0, canceladas: 0, pendientes: 0 };

        const porDia = await db.collection('citas').aggregate([
            { $match: citasFilter },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } },
                    total: { $sum: 1 },
                    finalizadas: { $sum: { $cond: [{ $eq: ['$estado', 'finalizada'] }, 1, 0] } }
                }
            },
            { $project: { fecha: '$_id', total: 1, finalizadas: 1, _id: 0 } },
            { $sort: { fecha: -1 } },
            { $limit: 30 }
        ]).toArray();

        const masSolicitados = await db.collection('citas').aggregate([
            { $match: { ...citasFilter, servicio_id: { $exists: true } } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioDoc'
                }
            },
            { $unwind: '$servicioDoc' },
            {
                $group: {
                    _id: '$servicioDoc.nombre',
                    cantidad: { $sum: 1 }
                }
            },
            { $project: { nombre: '$_id', cantidad: 1, _id: 0 } },
            { $sort: { cantidad: -1 } },
            { $limit: 10 }
        ]).toArray();

        res.json({
            resumen,
            porDia,
            masSolicitados
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de citas' });
    }
});

router.get('/cuadre', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const hoy = getRDDateString();

        const estadoCaja = await db.collection('config').findOne({ negocio_id: normalizeId(req.session.negocioId) });

        const aperturaTurno = estadoCaja && estadoCaja.caja_abierta_desde ? estadoCaja.caja_abierta_desde : null;
        const cajaCerrada = Boolean(estadoCaja && Number(estadoCaja.caja_cerrada) === 1);

        let turnoFilter = {};
        if (aperturaTurno) {
            turnoFilter.fecha = { $gte: new Date(aperturaTurno) };
        }

        if (cajaCerrada) {
            const negocio = await db.collection('negocios').findOne(
                { _id: normalizeId(req.session.negocioId) },
                { projection: { nombre: 1, direccion: 1, telefono: 1 } }
            );
            return res.json({
                resumen: { total: 0, cantidad: 0, efectivo: 0, transferencia: 0, tarjeta: 0 },
                resumenFueraCuadre: { total: 0, cantidad: 0 },
                porBancoTransferencia: [],
                porBancoTarjeta: [],
                ventas: [],
                egresosTurno: { total_egresos: 0, cantidad: 0, efectivo: 0, transferencia: 0, itbis_pagado_total: 0 },
                listaEgresosTurno: [],
                efectivoNeto: 0,
                itbisCobrado: 0,
                itbisPagado: 0,
                itbisNeto: 0,
                fecha: hoy,
                caja_cerrada: true,
                negocio: negocio ? mapId(negocio) : { nombre: 'Mi Negocio', direccion: '', telefono: '' }
            });
        }

        const baseVentasFilter = {
            negocio_id: normalizeId(req.session.negocioId),
            cuadre_id: null,
            ...turnoFilter
        };

        const resumenAgg = await db.collection('ventas').aggregate([
            { $match: baseVentasFilter },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 },
                    efectivo: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'efectivo'] }, { $ifNull: ['$total', 0] }, 0] } },
                    transferencia: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'transferencia'] }, { $ifNull: ['$total', 0] }, 0] } },
                    tarjeta: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'tarjeta'] }, { $ifNull: ['$total', 0] }, 0] } }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total: 0, cantidad: 0, efectivo: 0, transferencia: 0, tarjeta: 0 };

        const porBancoTransferencia = await db.collection('ventas').aggregate([
            { $match: { ...baseVentasFilter, metodo_pago: 'transferencia' } },
            {
                $group: {
                    _id: { $ifNull: ['$banco', 'Sin banco'] },
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 }
                }
            },
            { $project: { banco: '$_id', total: 1, cantidad: 1, _id: 0 } }
        ]).toArray();

        const porBancoTarjeta = await db.collection('ventas').aggregate([
            { $match: { ...baseVentasFilter, metodo_pago: 'tarjeta' } },
            {
                $group: {
                    _id: { $ifNull: ['$banco', 'Sin banco'] },
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 }
                }
            },
            { $project: { banco: '$_id', total: 1, cantidad: 1, _id: 0 } }
        ]).toArray();

        const resumenFueraCuadreAgg = await db.collection('ventas').aggregate([
            { $match: { ...baseVentasFilter, fuera_cuadre: true } },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 }
                }
            }
        ]).toArray();

        const resumenFueraCuadre = resumenFueraCuadreAgg[0] || { total: 0, cantidad: 0 };

        const ventas = await db.collection('ventas').aggregate([
            { $match: baseVentasFilter },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: 1 } },
            {
                $project: {
                    id: { $toString: '$_id' }, total: 1, metodo_pago: 1, banco: 1, fecha: 1, fuera_cuadre: 1,
                    cliente: { $ifNull: ['$clienteDoc.nombre', null] }
                }
            }
        ]).toArray();

        const ventasConDetalles = [];
        for (const venta of ventas) {
            const detalles = await db.collection('venta_detalles').aggregate([
                { $match: { venta_id: venta.id } },
                {
                    $lookup: {
                        from: 'servicios',
                        localField: 'servicio_id',
                        foreignField: '_id',
                        as: 'servicioDoc'
                    }
                },
                { $unwind: { path: '$servicioDoc', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        cantidad: 1, precio: 1, subtotal: 1,
                        servicio: { $ifNull: ['$servicioDoc.nombre', null] }
                    }
                }
            ]).toArray();

            ventasConDetalles.push({
                ...venta,
                detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
            });
        }

        const baseEgresosFilter = {
            negocio_id: normalizeId(req.session.negocioId),
            tipo: 'gasto',
            cuadre_id: null,
            ...turnoFilter
        };

        const egresosTurnoAgg = await db.collection('estado_resultado_items').aggregate([
            { $match: baseEgresosFilter },
            {
                $group: {
                    _id: null,
                    total_egresos: { $sum: { $ifNull: ['$monto', 0] } },
                    cantidad: { $sum: 1 },
                    efectivo: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'efectivo'] }, { $ifNull: ['$monto', 0] }, 0] } },
                    transferencia: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'transferencia'] }, { $ifNull: ['$monto', 0] }, 0] } },
                    itbis_pagado_total: { $sum: { $ifNull: ['$itbis_pagado', 0] } }
                }
            }
        ]).toArray();

        const egresosTurno = egresosTurnoAgg[0] || { total_egresos: 0, cantidad: 0, efectivo: 0, transferencia: 0, itbis_pagado_total: 0 };

        const itbisCobradoAgg = await db.collection('ventas').aggregate([
            { $match: baseVentasFilter },
            { $group: { _id: null, itbis_cobrado: { $sum: { $ifNull: ['$itbis', 0] } } } }
        ]).toArray();

        const itbisCobrado = itbisCobradoAgg[0] || { itbis_cobrado: 0 };

        const listaEgresosTurno = await db.collection('estado_resultado_items').find(baseEgresosFilter)
            .sort({ created_at: -1 })
            .project({ id: { $toString: '$_id' }, categoria: 1, descripcion: 1, monto: 1, metodo_pago: 1, fecha: 1, hora: 1, _id: 0 })
            .toArray();

        const efectivoNeto = resumen.efectivo - (egresosTurno.efectivo || 0);

        const negocio = await db.collection('negocios').findOne(
            { _id: normalizeId(req.session.negocioId) },
            { projection: { nombre: 1, direccion: 1, telefono: 1 } }
        );

        res.json({
            resumen,
            resumenFueraCuadre,
            porBancoTransferencia,
            porBancoTarjeta,
            ventas: ventasConDetalles,
            egresosTurno,
            listaEgresosTurno,
            efectivoNeto,
            itbisCobrado: itbisCobrado.itbis_cobrado,
            itbisPagado: egresosTurno.itbis_pagado_total,
            itbisNeto: (itbisCobrado.itbis_cobrado || 0) - (egresosTurno.itbis_pagado_total || 0),
            fecha: hoy,
            caja_cerrada: cajaCerrada,
            negocio: negocio ? mapId(negocio) : { nombre: 'Mi Negocio', direccion: '', telefono: '' }
        });
    } catch (error) {
        console.error('Error en GET /cuadre:', error);
        res.status(500).json({ error: 'Error al obtener cuadre' });
    }
});

router.get('/cuadre/preview', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const hoy = getRDDateString();
        const inicioMes = `${getRDDate().getFullYear()}-${String(getRDDate().getMonth() + 1).padStart(2, '0')}-01`;

        const tipo = req.query.tipo || 'dia';
        const fechaPersonalizada = req.query.fecha || null;

        if (!['dia', 'mes'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de cierre invalido. Valores permitidos: dia, mes' });
        }
        if (fechaPersonalizada && !isValidISODate(fechaPersonalizada)) {
            return res.status(400).json({ error: 'Fecha de cierre invalida. Formato esperado: YYYY-MM-DD' });
        }
        if (tipo === 'mes' && fechaPersonalizada && fechaPersonalizada > hoy) {
            return res.status(400).json({ error: 'La fecha de cierre no puede ser futura' });
        }

        let fechaDesde;
        if (tipo === 'mes' && fechaPersonalizada) {
            fechaDesde = fechaPersonalizada;
        } else if (tipo === 'mes') {
            fechaDesde = inicioMes;
        } else {
            fechaDesde = hoy;
        }

        const estadoCaja = await db.collection('config').findOne({ negocio_id: normalizeId(req.session.negocioId) });
        const aperturaTurno = estadoCaja && estadoCaja.caja_abierta_desde ? estadoCaja.caja_abierta_desde : null;

        let ventasFilter = { negocio_id: normalizeId(req.session.negocioId), cuadre_id: null };
        if (tipo === 'dia') {
            if (aperturaTurno) {
                ventasFilter.fecha = { $gte: new Date(aperturaTurno) };
            } else {
                ventasFilter.fecha = {
                    $gte: new Date(`${hoy}T00:00:00.000Z`),
                    $lte: new Date(`${hoy}T23:59:59.999Z`)
                };
            }
        } else {
            ventasFilter.fecha = { $gte: new Date(`${fechaDesde}T00:00:00.000Z`) };
        }

        const resumenAgg = await db.collection('ventas').aggregate([
            { $match: ventasFilter },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 },
                    efectivo: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'efectivo'] }, { $ifNull: ['$total', 0] }, 0] } },
                    transferencia: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'transferencia'] }, { $ifNull: ['$total', 0] }, 0] } },
                    tarjeta: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'tarjeta'] }, { $ifNull: ['$total', 0] }, 0] } }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total: 0, cantidad: 0, efectivo: 0, transferencia: 0, tarjeta: 0 };

        let egresosFilter = { negocio_id: normalizeId(req.session.negocioId), cuadre_id: null, tipo: 'gasto' };
        if (tipo === 'dia') {
            if (aperturaTurno) {
                egresosFilter.fecha = { $gte: new Date(aperturaTurno) };
            } else {
                egresosFilter.fecha = {
                    $gte: new Date(`${hoy}T00:00:00.000Z`),
                    $lte: new Date(`${hoy}T23:59:59.999Z`)
                };
            }
        } else {
            egresosFilter.fecha = { $gte: new Date(`${fechaDesde}T00:00:00.000Z`) };
        }

        const egresosAgg = await db.collection('estado_resultado_items').aggregate([
            { $match: egresosFilter },
            {
                $group: {
                    _id: null,
                    total_egresos: { $sum: { $ifNull: ['$monto', 0] } },
                    cantidad: { $sum: 1 }
                }
            }
        ]).toArray();

        const egresos = egresosAgg[0] || { total_egresos: 0, cantidad: 0 };

        res.json({
            tipo,
            rango: {
                desde: tipo === 'dia' ? (aperturaTurno || hoy) : fechaDesde,
                hasta: hoy
            },
            resumen,
            egresos
        });
    } catch (error) {
        console.error('Error en GET /cuadre/preview:', error);
        res.status(500).json({ error: 'Error al obtener preview de cierre' });
    }
});

router.post('/cuadre/cerrar', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const hoy = getRDDateString();
        const inicioMes = `${getRDDate().getFullYear()}-${String(getRDDate().getMonth() + 1).padStart(2, '0')}-01`;

        const tipo = req.body.tipo || 'dia';
        const fechaPersonalizada = req.body.fecha || null;

        if (!['dia', 'mes'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo de cierre invalido. Valores permitidos: dia, mes' });
        }
        if (fechaPersonalizada && !isValidISODate(fechaPersonalizada)) {
            return res.status(400).json({ error: 'Fecha de cierre invalida. Formato esperado: YYYY-MM-DD' });
        }
        if (tipo === 'mes' && fechaPersonalizada && fechaPersonalizada > hoy) {
            return res.status(400).json({ error: 'La fecha de cierre no puede ser futura' });
        }

        let fechaDesde;
        let fechaCierre;

        if (tipo === 'mes' && fechaPersonalizada) {
            fechaDesde = fechaPersonalizada;
            fechaCierre = `${fechaPersonalizada} al ${hoy}`;
        } else if (tipo === 'mes') {
            fechaDesde = inicioMes;
            fechaCierre = `${inicioMes} al ${hoy}`;
        } else {
            fechaDesde = hoy;
            fechaCierre = hoy;
        }

        const estadoCaja = await db.collection('config').findOne({ negocio_id: normalizeId(req.session.negocioId) });
        const aperturaTurno = estadoCaja && estadoCaja.caja_abierta_desde ? estadoCaja.caja_abierta_desde : null;

        let ventasFilter = { negocio_id: normalizeId(req.session.negocioId), cuadre_id: null };
        if (tipo === 'dia') {
            if (aperturaTurno) {
                ventasFilter.fecha = { $gte: new Date(aperturaTurno) };
            } else {
                ventasFilter.fecha = {
                    $gte: new Date(`${hoy}T00:00:00.000Z`),
                    $lte: new Date(`${hoy}T23:59:59.999Z`)
                };
            }
        } else {
            ventasFilter.fecha = { $gte: new Date(`${fechaDesde}T00:00:00.000Z`) };
        }

        const resumenAgg = await db.collection('ventas').aggregate([
            { $match: ventasFilter },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 },
                    efectivo: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'efectivo'] }, { $ifNull: ['$total', 0] }, 0] } },
                    transferencia: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'transferencia'] }, { $ifNull: ['$total', 0] }, 0] } },
                    tarjeta: { $sum: { $cond: [{ $eq: ['$metodo_pago', 'tarjeta'] }, { $ifNull: ['$total', 0] }, 0] } }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total: 0, cantidad: 0, efectivo: 0, transferencia: 0, tarjeta: 0 };

        if (resumen.cantidad === 0) {
            return res.status(400).json({ error: 'No hay ventas pendientes. La caja ya está cerrada o no hay ventas nuevas.' });
        }

        const arqueo = req.body.arqueo || {};
        const justificacion = (req.body.justificacion || '').trim();
        function toInt(val) {
            return Number.isFinite(+val) ? Math.round(+val) : 0;
        }
        const arqueoEfectivo = toInt(arqueo.efectivo);
        const arqueoTransferencia = toInt(arqueo.transferencia);
        const arqueoTarjeta = toInt(arqueo.tarjeta);

        const diffEfectivo = arqueoEfectivo - Math.round(resumen.efectivo);
        const diffTransferencia = arqueoTransferencia - Math.round(resumen.transferencia);
        const diffTarjeta = arqueoTarjeta - Math.round(resumen.tarjeta);
        const diferenciaTotal = diffEfectivo + diffTransferencia + diffTarjeta;

        if (diferenciaTotal !== 0 && justificacion.length < 5) {
            return res.status(400).json({ error: 'Debe justificar la diferencia de arqueo.' });
        }

        const session = await db.startSession();
        try {
            await session.withTransaction(async () => {
                const cierreResult = await db.collection('cajas_cerradas').insertOne({
                    negocio_id: normalizeId(req.session.negocioId),
                    fecha: fechaCierre,
                    total: resumen.total,
                    cantidad_ventas: resumen.cantidad,
                    efectivo: resumen.efectivo,
                    transferencia: resumen.transferencia,
                    tarjeta: resumen.tarjeta,
                    user_id: req.session.userId,
                    notas: (tipo === 'mes' ? '[CIERRE MENSUAL] ' : '') + (req.body.notas || ''),
                    arqueo_efectivo: arqueoEfectivo,
                    arqueo_transferencia: arqueoTransferencia,
                    arqueo_tarjeta: arqueoTarjeta,
                    justificacion
                }, { session });

                const cierreId = cierreResult.insertedId;

                try {
                    await db.collection('auditoria').insertOne({
                        negocio_id: normalizeId(req.session.negocioId),
                        user_id: req.session.userId,
                        accion: 'CIERRE_CAJA',
                        entidad: 'cajas_cerradas',
                        entidad_id: cierreId,
                        detalles: JSON.stringify({
                            arqueoEfectivo, arqueoTransferencia, arqueoTarjeta,
                            diffEfectivo, diffTransferencia, diffTarjeta, diferenciaTotal,
                            justificacion
                        }),
                        fecha: getRDDateString()
                    }, { session });
                } catch (e) {
                    console.error('Error registrando auditoría de cierre de caja:', e);
                }

                let updateVentasFilter = { cuadre_id: null, negocio_id: normalizeId(req.session.negocioId) };
                if (tipo === 'dia') {
                    if (aperturaTurno) {
                        updateVentasFilter.fecha = { $gte: new Date(aperturaTurno) };
                    } else {
                        updateVentasFilter.fecha = {
                            $gte: new Date(`${hoy}T00:00:00.000Z`),
                            $lte: new Date(`${hoy}T23:59:59.999Z`)
                        };
                    }
                } else {
                    updateVentasFilter.fecha = { $gte: new Date(`${fechaDesde}T00:00:00.000Z`) };
                }

                await db.collection('ventas').updateMany(
                    updateVentasFilter,
                    { $set: { cuadre_id: cierreId } },
                    { session }
                );

                let updateEgresosFilter = { cuadre_id: null, negocio_id: normalizeId(req.session.negocioId), tipo: 'gasto' };
                if (tipo === 'dia') {
                    if (aperturaTurno) {
                        updateEgresosFilter.fecha = { $gte: new Date(aperturaTurno) };
                    } else {
                        updateEgresosFilter.fecha = {
                            $gte: new Date(`${hoy}T00:00:00.000Z`),
                            $lte: new Date(`${hoy}T23:59:59.999Z`)
                        };
                    }
                } else {
                    updateEgresosFilter.fecha = { $gte: new Date(`${fechaDesde}T00:00:00.000Z`) };
                }

                await db.collection('estado_resultado_items').updateMany(
                    updateEgresosFilter,
                    { $set: { cuadre_id: cierreId } },
                    { session }
                );

                if (tipo === 'dia') {
                    try {
                        await db.collection('config').updateOne(
                            { negocio_id: normalizeId(req.session.negocioId) },
                            { $set: { caja_cerrada: 1 } },
                            { upsert: true, session }
                        );
                    } catch (e) {
                        console.error('Error actualizando config:', e);
                    }
                }

                const ventasDelDia = await db.collection('ventas').aggregate([
                    { $match: { negocio_id: normalizeId(req.session.negocioId), cuadre_id: cierreId } },
                    {
                        $lookup: {
                            from: 'clientes',
                            localField: 'cliente_id',
                            foreignField: '_id',
                            as: 'clienteDoc'
                        }
                    },
                    { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
                    { $sort: { fecha: 1 } },
                    {
                        $project: {
                            id: { $toString: '$_id' }, total: 1, metodo_pago: 1, banco: 1, fecha: 1,
                            cliente: { $ifNull: ['$clienteDoc.nombre', null] }
                        }
                    }
                ]).toArray();

                const ventasConDetalles = [];
                for (const venta of ventasDelDia) {
                    const detalles = await db.collection('venta_detalles').aggregate([
                        { $match: { venta_id: venta.id } },
                        {
                            $lookup: {
                                from: 'servicios',
                                localField: 'servicio_id',
                                foreignField: '_id',
                                as: 'servicioDoc'
                            }
                        },
                        { $unwind: { path: '$servicioDoc', preserveNullAndEmptyArrays: true } },
                        {
                            $project: {
                                cantidad: 1, precio: 1,
                                servicio: { $ifNull: ['$servicioDoc.nombre', null] }
                            }
                        }
                    ]).toArray();

                    ventasConDetalles.push({
                        ...venta,
                        detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
                    });
                }

                const porBancoTrans = await db.collection('ventas').aggregate([
                    { $match: { negocio_id: normalizeId(req.session.negocioId), cuadre_id: cierreId, metodo_pago: 'transferencia' } },
                    {
                        $group: {
                            _id: { $ifNull: ['$banco', 'Sin banco'] },
                            total: { $sum: '$total' },
                            cantidad: { $sum: 1 }
                        }
                    },
                    { $project: { banco: '$_id', total: 1, cantidad: 1, _id: 0 } }
                ]).toArray();

                const porBancoTarj = await db.collection('ventas').aggregate([
                    { $match: { negocio_id: normalizeId(req.session.negocioId), cuadre_id: cierreId, metodo_pago: 'tarjeta' } },
                    {
                        $group: {
                            _id: { $ifNull: ['$banco', 'Sin banco'] },
                            total: { $sum: '$total' },
                            cantidad: { $sum: 1 }
                        }
                    },
                    { $project: { banco: '$_id', total: 1, cantidad: 1, _id: 0 } }
                ]).toArray();

                let egresos = null;
                let totalEntregar = null;

                if (tipo === 'mes') {
                    try {
                        const egresosAgg = await db.collection('estado_resultado_items').aggregate([
                            {
                                $match: {
                                    negocio_id: normalizeId(req.session.negocioId),
                                    tipo: 'gasto',
                                    fecha: { $gte: new Date(`${inicioMes}T00:00:00.000Z`) }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    costo_ventas: {
                                        $sum: {
                                            $cond: [
                                                { $and: [{ $eq: ['$categoria', 'costo_ventas'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                                { $ifNull: ['$monto', 0] }, 0
                                            ]
                                        }
                                    },
                                    gastos_fijos: {
                                        $sum: {
                                            $cond: [
                                                { $and: [{ $eq: ['$categoria', 'gastos_operativos'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                                { $ifNull: ['$monto', 0] }, 0
                                            ]
                                        }
                                    },
                                    otros_costos: {
                                        $sum: {
                                            $cond: [
                                                { $and: [{ $eq: ['$categoria', 'otros_gastos'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                                { $ifNull: ['$monto', 0] }, 0
                                            ]
                                        }
                                    },
                                    gastos_personales: {
                                        $sum: {
                                            $cond: [{ $eq: ['$subtipo', 'gasto'] }, { $ifNull: ['$monto', 0] }, 0]
                                        }
                                    },
                                    total_costos: {
                                        $sum: {
                                            $cond: [{ $in: ['$subtipo', ['costo', null]] }, { $ifNull: ['$monto', 0] }, 0]
                                        }
                                    },
                                    total_gastos: {
                                        $sum: {
                                            $cond: [{ $eq: ['$subtipo', 'gasto'] }, { $ifNull: ['$monto', 0] }, 0]
                                        }
                                    }
                                }
                            }
                        ]).toArray();

                        egresos = egresosAgg[0] || { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0 };
                        totalEntregar = resumen.total - ((egresos.total_costos || 0) + (egresos.total_gastos || 0));
                    } catch (egresosError) {
                        console.error('Error obteniendo egresos:', egresosError);
                        egresos = { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0, total_egresos: 0 };
                        totalEntregar = resumen.total;
                    }
                }

                const negocio = await db.collection('negocios').findOne(
                    { _id: normalizeId(req.session.negocioId) },
                    { projection: { nombre: 1, direccion: 1, telefono: 1 } }
                );

                res.json({
                    success: true,
                    mensaje: 'Caja cerrada correctamente',
                    cierreId,
                    negocio: negocio ? mapId(negocio) : { nombre: 'Mi Negocio', direccion: '', telefono: '' },
                    resumen,
                    porBancoTransferencia: porBancoTrans,
                    porBancoTarjeta: porBancoTarj,
                    egresos,
                    totalEntregar,
                    tipo,
                    ventas: ventasConDetalles
                });
            });
        } finally {
            await session.endSession();
        }
    } catch (error) {
        console.error('Error en cierre de caja:', error);
        res.status(500).json({ error: 'Error al cerrar caja: ' + error.message });
    }
});

router.post('/cuadre/abrir', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();

        try {
            await db.collection('config').updateOne(
                { negocio_id: normalizeId(req.session.negocioId) },
                { $set: { caja_cerrada: 0, caja_abierta_desde: getRDTimestamp() } },
                { upsert: true }
            );
        } catch (e) {
            console.error('Error abriendo caja:', e);
        }

        res.json({ success: true, mensaje: 'Caja abierta. Nuevo turno iniciado en limpio.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
});

router.get('/cuadre/historial', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();

        const hace7dias = getRDDate();
        hace7dias.setDate(hace7dias.getDate() - 7);
        const fechaMin = getRDDateString(hace7dias);

        const historial = await db.collection('cajas_cerradas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    deleted_at: null,
                    fecha: { $gte: fechaMin }
                }
            },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuarioDoc'
                }
            },
            { $unwind: { path: '$usuarioDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: -1 } },
            {
                $project: {
                    id: { $toString: '$_id' },
                    fecha: 1, total: 1, cantidad_ventas: 1, efectivo: 1, transferencia: 1, tarjeta: 1,
                    notas: 1, arqueo_efectivo: 1, arqueo_transferencia: 1, arqueo_tarjeta: 1, justificacion: 1,
                    fondo_inicial: 1,
                    usuario: { $ifNull: ['$usuarioDoc.nombre', null] }
                }
            }
        ]).toArray();

        res.json(historial);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

router.get('/cuadre/detalles/:fecha', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const fecha = req.params.fecha;

        if (!fecha || typeof fecha !== 'string' || fecha.length > 30) {
            return res.status(400).json({ error: 'Parametro "fecha" invalido' });
        }

        const cierre = await db.collection('cajas_cerradas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    deleted_at: null,
                    fecha: fecha
                }
            },
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
                    id: { $toString: '$_id' },
                    fecha: 1, total: 1, cantidad_ventas: 1, efectivo: 1, transferencia: 1, tarjeta: 1,
                    notas: 1, arqueo_efectivo: 1, arqueo_transferencia: 1, arqueo_tarjeta: 1, justificacion: 1,
                    fondo_inicial: 1,
                    usuario: { $ifNull: ['$usuarioDoc.nombre', null] }
                }
            }
        ]).toArray();

        if (!cierre || cierre.length === 0) {
            return res.status(404).json({ error: 'No se encontró cierre para esta fecha' });
        }

        const cierreDoc = cierre[0];

        const ventas = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    fecha: {
                        $gte: new Date(`${fecha}T00:00:00.000Z`),
                        $lte: new Date(`${fecha}T23:59:59.999Z`)
                    }
                }
            },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteDoc'
                }
            },
            { $unwind: { path: '$clienteDoc', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: 1 } },
            {
                $project: {
                    id: { $toString: '$_id' }, total: 1, metodo_pago: 1, banco: 1, fecha: 1,
                    cliente: { $ifNull: ['$clienteDoc.nombre', null] }
                }
            }
        ]).toArray();

        const ventasConDetalles = [];
        for (const venta of ventas) {
            const detalles = await db.collection('venta_detalles').aggregate([
                { $match: { venta_id: venta.id } },
                {
                    $lookup: {
                        from: 'servicios',
                        localField: 'servicio_id',
                        foreignField: '_id',
                        as: 'servicioDoc'
                    }
                },
                { $unwind: { path: '$servicioDoc', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        cantidad: 1, precio: 1,
                        servicio: { $ifNull: ['$servicioDoc.nombre', null] }
                    }
                }
            ]).toArray();

            ventasConDetalles.push({
                ...venta,
                detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
            });
        }

        const porBancoTrans = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    metodo_pago: 'transferencia',
                    fecha: {
                        $gte: new Date(`${fecha}T00:00:00.000Z`),
                        $lte: new Date(`${fecha}T23:59:59.999Z`)
                    }
                }
            },
            {
                $group: {
                    _id: { $ifNull: ['$banco', 'Sin banco'] },
                    total: { $sum: '$total' }
                }
            },
            { $project: { banco: '$_id', total: 1, _id: 0 } }
        ]).toArray();

        const porBancoTarj = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    metodo_pago: 'tarjeta',
                    fecha: {
                        $gte: new Date(`${fecha}T00:00:00.000Z`),
                        $lte: new Date(`${fecha}T23:59:59.999Z`)
                    }
                }
            },
            {
                $group: {
                    _id: { $ifNull: ['$banco', 'Sin banco'] },
                    total: { $sum: '$total' }
                }
            },
            { $project: { banco: '$_id', total: 1, _id: 0 } }
        ]).toArray();

        const esCierreMensual = cierreDoc.notas && cierreDoc.notas.includes('[CIERRE MENSUAL]');
        let egresos = null;
        let totalEntregar = null;

        if (esCierreMensual) {
            const inicioMes = fecha.substring(0, 7) + '-01';
            try {
                const egresosAgg = await db.collection('estado_resultado_items').aggregate([
                    {
                        $match: {
                            negocio_id: normalizeId(req.session.negocioId),
                            tipo: 'gasto',
                            fecha: { $gte: new Date(`${inicioMes}T00:00:00.000Z`) }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            costo_ventas: {
                                $sum: {
                                    $cond: [
                                        { $and: [{ $eq: ['$categoria', 'costo_ventas'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                        { $ifNull: ['$monto', 0] }, 0
                                    ]
                                }
                            },
                            gastos_fijos: {
                                $sum: {
                                    $cond: [
                                        { $and: [{ $eq: ['$categoria', 'gastos_operativos'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                        { $ifNull: ['$monto', 0] }, 0
                                    ]
                                }
                            },
                            otros_costos: {
                                $sum: {
                                    $cond: [
                                        { $and: [{ $eq: ['$categoria', 'otros_gastos'] }, { $in: ['$subtipo', ['costo', null]] }] },
                                        { $ifNull: ['$monto', 0] }, 0
                                    ]
                                }
                            },
                            gastos_personales: {
                                $sum: {
                                    $cond: [{ $eq: ['$subtipo', 'gasto'] }, { $ifNull: ['$monto', 0] }, 0]
                                }
                            },
                            total_costos: {
                                $sum: {
                                    $cond: [{ $in: ['$subtipo', ['costo', null]] }, { $ifNull: ['$monto', 0] }, 0]
                                }
                            },
                            total_gastos: {
                                $sum: {
                                    $cond: [{ $eq: ['$subtipo', 'gasto'] }, { $ifNull: ['$monto', 0] }, 0]
                                }
                            }
                        }
                    }
                ]).toArray();

                egresos = egresosAgg[0] || { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0 };
                totalEntregar = cierreDoc.total - ((egresos.total_costos || 0) + (egresos.total_gastos || 0));
            } catch (egresosError) {
                console.error('Error obteniendo egresos:', egresosError);
                egresos = { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0 };
                totalEntregar = cierreDoc.total;
            }
        }

        const negocio = await db.collection('negocios').findOne(
            { _id: normalizeId(req.session.negocioId) },
            { projection: { nombre: 1, direccion: 1, telefono: 1 } }
        );

        res.json({
            cierre: cierreDoc,
            ventas: ventasConDetalles,
            porBancoTransferencia: porBancoTrans,
            porBancoTarjeta: porBancoTarj,
            egresos,
            totalEntregar,
            tipo: esCierreMensual ? 'mes' : 'dia',
            negocio: negocio ? mapId(negocio) : { nombre: 'Mi Negocio', direccion: '', telefono: '' }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener detalles' });
    }
});

router.delete('/cuadre/cleanup', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const fechaLimite = getRDDate();
        fechaLimite.setDate(fechaLimite.getDate() - 7);
        const fechaLimiteStr = getRDDateString(fechaLimite);

        const result = await db.collection('cajas_cerradas').updateMany(
            {
                negocio_id: normalizeId(req.session.negocioId),
                deleted_at: null,
                fecha: { $lt: fechaLimiteStr }
            },
            { $set: { deleted_at: getRDTimestamp(), deleted_by: req.session.userId || null } }
        );

        res.json({
            success: true,
            mensaje: `Se archivaron ${result.modifiedCount} cuadres antiguos`,
            eliminados: result.modifiedCount
        });
    } catch (error) {
        console.error('Error cleanup:', error);
        res.status(500).json({ error: 'Error al limpiar cuadres: ' + error.message });
    }
});

router.delete('/cuadre/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const cuadreId = normalizeId(req.params.id);

        let objectId;
        try {
            objectId = cuadreId;
        } catch {
            return res.status(400).json({ error: 'ID de cuadre invalido' });
        }

        const caja = await db.collection('cajas_cerradas').findOne({
            _id: objectId,
            negocio_id: normalizeId(req.session.negocioId),
            deleted_at: null
        });

        if (!caja) {
            return res.status(404).json({ error: 'Cuadre no encontrado' });
        }

        await db.collection('ventas').updateMany(
            { cuadre_id: objectId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { cuadre_id: null } }
        );

        await db.collection('estado_resultado_items').updateMany(
            { cuadre_id: objectId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { cuadre_id: null } }
        );

        await db.collection('cajas_cerradas').updateOne(
            { _id: objectId },
            { $set: { deleted_at: getRDTimestamp(), deleted_by: req.session.userId || null } }
        );

        res.json({ success: true, mensaje: 'Cuadre archivado. Las ventas vuelven a estar pendientes.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al archivar cuadre' });
    }
});

router.get('/domain/appointments-kpis', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) return;

        const now = getRDDate();
        const fechaHoy = getRDDateString(now);
        const horaHoy = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const citasFilter = { negocio_id: normalizeId(req.session.negocioId), ...dateRangeFilter('fecha', desde, hasta) };

        const resumenAgg = await db.collection('citas').aggregate([
            { $match: citasFilter },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    finalizadas: { $sum: { $cond: [{ $eq: ['$estado', 'finalizada'] }, 1, 0] } },
                    canceladas: { $sum: { $cond: [{ $eq: ['$estado', 'cancelada'] }, 1, 0] } },
                    no_show: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $in: ['$estado', ['pendiente', 'confirmada']] },
                                        {
                                            $or: [
                                                { $lt: ['$fecha', new Date(`${fechaHoy}T00:00:00.000Z`)] },
                                                {
                                                    $and: [
                                                        { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$fecha' } }, fechaHoy] },
                                                        { $lt: ['$hora_fin', horaHoy] }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                },
                                1, 0
                            ]
                        }
                    }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total: 0, finalizadas: 0, canceladas: 0, no_show: 0 };

        const minutosOcupadosAgg = await db.collection('citas').aggregate([
            { $match: { ...citasFilter, estado: { $ne: 'cancelada' } } },
            {
                $group: {
                    _id: null,
                    minutos: {
                        $sum: {
                            $subtract: [
                                { $add: [
                                    { $multiply: [{ $toInt: { $substr: ['$hora_fin', 0, 2] } }, 60] },
                                    { $toInt: { $substr: ['$hora_fin', 3, 2] } }
                                ]},
                                { $add: [
                                    { $multiply: [{ $toInt: { $substr: ['$hora_inicio', 0, 2] } }, 60] },
                                    { $toInt: { $substr: ['$hora_inicio', 3, 2] } }
                                ]}
                            ]
                        }
                    }
                }
            }
        ]).toArray();

        const minutosOcupados = minutosOcupadosAgg[0] || { minutos: 0 };

        const negocio = await db.collection('negocios').findOne(
            { _id: normalizeId(req.session.negocioId) },
            { projection: { hora_apertura: 1, hora_cierre: 1, dias_laborales: 1 } }
        );

        const inicio = desde || fechaHoy;
        const fin = hasta || fechaHoy;
        const [aH, aM] = (negocio?.hora_apertura || '08:00').split(':').map(Number);
        const [cH, cM] = (negocio?.hora_cierre || '18:00').split(':').map(Number);
        const minutosDia = Math.max(0, (cH * 60 + cM) - (aH * 60 + aM));
        const diasLaborales = (negocio?.dias_laborales || '1,2,3,4,5,6')
            .split(',')
            .map(d => Number.parseInt(d, 10))
            .filter(n => Number.isInteger(n));

        let diasActivos = 0;
        let cursor = new Date(`${inicio}T00:00:00`);
        const finDate = new Date(`${fin}T00:00:00`);
        while (cursor <= finDate) {
            const dow = cursor.getDay();
            if (diasLaborales.includes(dow)) diasActivos += 1;
            cursor.setDate(cursor.getDate() + 1);
        }

        const capacidadMinutos = diasActivos * minutosDia;
        const ocupacion = capacidadMinutos > 0 ? (minutosOcupados.minutos / capacidadMinutos) * 100 : 0;
        const puntualidad = (resumen.finalizadas + resumen.no_show) > 0
            ? (resumen.finalizadas / (resumen.finalizadas + resumen.no_show)) * 100
            : 100;

        res.json({
            total: resumen.total || 0,
            finalizadas: resumen.finalizadas || 0,
            canceladas: resumen.canceladas || 0,
            no_show: resumen.no_show || 0,
            ocupacion,
            puntualidad
        });
    } catch (error) {
        console.error('Error en KPI citas:', error);
        res.status(500).json({ error: 'Error al obtener KPI de citas' });
    }
});

router.get('/domain/orders-kpis', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) return;

        const pedidosFilter = { negocio_id: normalizeId(req.session.negocioId), ...dateRangeFilter('fecha_creacion', desde, hasta) };

        const resumenAgg = await db.collection('pedidos').aggregate([
            { $match: pedidosFilter },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    entregados: { $sum: { $cond: [{ $eq: ['$estado', 'entregado'] }, 1, 0] } },
                    cancelados: { $sum: { $cond: [{ $eq: ['$estado', 'cancelado'] }, 1, 0] } },
                    min_preparacion: {
                        $avg: {
                            $cond: [
                                { $and: [
                                    { $ne: ['$fecha_listo', null] },
                                    { $ne: [{ $ifNull: ['$fecha_preparando', '$fecha_confirmado'] }, null] }
                                ]},
                                {
                                    $divide: [
                                        { $subtract: [
                                            { $toDate: '$fecha_listo' },
                                            { $toDate: { $ifNull: ['$fecha_preparando', '$fecha_confirmado'] } }
                                        ]},
                                        60000
                                    ]
                                },
                                null
                            ]
                        }
                    },
                    min_entrega: {
                        $avg: {
                            $cond: [
                                { $and: [
                                    { $ne: ['$fecha_entregado', null] },
                                    { $ne: ['$fecha_listo', null] }
                                ]},
                                {
                                    $divide: [
                                        { $subtract: [
                                            { $toDate: '$fecha_entregado' },
                                            { $toDate: '$fecha_listo' }
                                        ]},
                                        60000
                                    ]
                                },
                                null
                            ]
                        }
                    },
                    min_ciclo: {
                        $avg: {
                            $cond: [
                                { $ne: ['$fecha_entregado', null] },
                                {
                                    $divide: [
                                        { $subtract: [
                                            { $toDate: '$fecha_entregado' },
                                            { $toDate: '$fecha_creacion' }
                                        ]},
                                        60000
                                    ]
                                },
                                null
                            ]
                        }
                    }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total: 0, entregados: 0, cancelados: 0, min_preparacion: 0, min_entrega: 0, min_ciclo: 0 };

        const cancelaciones = (resumen.total || 0) > 0 ? ((resumen.cancelados || 0) / resumen.total) * 100 : 0;

        res.json({
            total: resumen.total || 0,
            entregados: resumen.entregados || 0,
            cancelados: resumen.cancelados || 0,
            cancelaciones,
            minutos_preparacion: resumen.min_preparacion || 0,
            minutos_entrega: resumen.min_entrega || 0,
            minutos_ciclo: resumen.min_ciclo || 0
        });
    } catch (error) {
        console.error('Error en KPI pedidos:', error);
        res.status(500).json({ error: 'Error al obtener KPI de pedidos' });
    }
});

router.get('/domain/fiscal-kpis', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { desde, hasta } = req.query;

        if (!validateDateRangeOrRespond(res, desde, hasta)) return;

        const ventasFilter = { negocio_id: normalizeId(req.session.negocioId), ...dateRangeFilter('fecha', desde, hasta) };

        const resumenAgg = await db.collection('ventas').aggregate([
            { $match: ventasFilter },
            {
                $group: {
                    _id: null,
                    total_ventas: { $sum: 1 },
                    total_facturado: { $sum: { $ifNull: ['$total', 0] } },
                    itbis: { $sum: { $ifNull: ['$itbis', 0] } },
                    e31: { $sum: { $cond: [{ $eq: ['$tipo_ecf', '31'] }, 1, 0] } },
                    e32: { $sum: { $cond: [{ $eq: ['$tipo_ecf', '32'] }, 1, 0] } },
                    ticket_promedio: { $avg: { $ifNull: ['$total', 0] } }
                }
            }
        ]).toArray();

        const resumen = resumenAgg[0] || { total_ventas: 0, total_facturado: 0, itbis: 0, e31: 0, e32: 0, ticket_promedio: 0 };

        res.json({
            total_ventas: resumen.total_ventas || 0,
            total_facturado: resumen.total_facturado || 0,
            itbis: resumen.itbis || 0,
            e31: resumen.e31 || 0,
            e32: resumen.e32 || 0,
            ticket_promedio: resumen.ticket_promedio || 0
        });
    } catch (error) {
        console.error('Error en KPI fiscal:', error);
        res.status(500).json({ error: 'Error al obtener KPI fiscal' });
    }
});

module.exports = router;
