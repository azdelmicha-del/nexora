const express = require('express');
const { getDb, getNextNCF , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generarCodigoSeguridad } = require('../utils/dgii');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/notes — Listar notas de credito/debito
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const notas = await db.collection('notas_credito').aggregate([
            { $match: { negocio_id: normalizeId(req.session.negocioId) } },
            {
                $lookup: {
                    from: 'ventas',
                    localField: 'venta_original_id',
                    foreignField: '_id',
                    as: 'venta'
                }
            },
            { $unwind: { path: '$venta', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'venta.cliente_id',
                    foreignField: '_id',
                    as: 'cliente'
                }
            },
            { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuario'
                }
            },
            { $unwind: { path: '$usuario', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: { $toString: '$_id' },
                    fecha: 1,
                    tipo_nota: 1,
                    secuencia_ecf: 1,
                    monto: 1,
                    motivo: 1,
                    estado_dgii: 1,
                    codigo_seguridad: 1,
                    venta_original_total: '$venta.total',
                    secuencia_original: '$venta.secuencia_ecf',
                    cliente_nombre: '$cliente.nombre',
                    cliente_documento: '$cliente.documento',
                    creado_por: '$usuario.nombre'
                }
            },
            { $sort: { fecha: -1 } }
        ]).toArray();

        res.json(notas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notas' });
    }
});

// POST /api/notes — Crear nota de credito/debito
router.post('/', requireAuth, async (req, res) => {
    try {
        const { venta_id, motivo, monto, tipo_nota = '34' } = req.body;

        if (!venta_id || !motivo || !monto) {
            return res.status(400).json({ error: 'venta_id, motivo y monto son requeridos' });
        }

        if (!['33', '34'].includes(tipo_nota)) {
            return res.status(400).json({ error: 'tipo_nota debe ser 33 (Debito) o 34 (Credito)' });
        }

        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

        const ventaOriginal = await db.collection('ventas').aggregate([
            { $match: { _id: venta_id, negocio_id: negocioId } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'cliente'
                }
            },
            { $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: { $toString: '$_id' },
                    total: 1,
                    subtotal: 1,
                    itbis: 1,
                    descuento: 1,
                    tipo_ecf: 1,
                    secuencia_ecf: 1,
                    cliente_id: 1,
                    fecha: 1,
                    cliente_nombre: '$cliente.nombre',
                    cliente_documento: '$cliente.documento',
                    cliente_tipo_doc: '$cliente.tipo_documento'
                }
            }
        ]).toArray();

        if (!ventaOriginal || ventaOriginal.length === 0) {
            return res.status(404).json({ error: 'Venta original no encontrada' });
        }

        const venta = ventaOriginal[0];
        const secuencia = getNextNCF(negocioId, tipo_nota);
        const codigoSeg = generarCodigoSeguridad();
        const montoAbs = Math.abs(parseFloat(monto));

        const result = await db.collection('notas_credito').insertOne({
            negocio_id: negocioId,
            user_id: req.session.userId,
            venta_original_id: venta_id,
            tipo_nota,
            secuencia_ecf: secuencia,
            codigo_seguridad: codigoSeg,
            monto: montoAbs,
            motivo: motivo.trim(),
            estado_dgii: 'pendiente',
            fecha: getRDDateString()
        });

        res.json({
            id: result.insertedId.toString(),
            tipo_nota: tipo_nota === '34' ? 'Nota de Credito' : 'Nota de Debito',
            secuencia_ecf: secuencia,
            venta_original_id: venta_id,
            secuencia_original: venta.secuencia_ecf,
            monto: montoAbs,
            motivo: motivo.trim()
        });
    } catch (error) {
        console.error('Error al crear nota:', error);
        res.status(500).json({ error: 'Error al crear nota: ' + error.message });
    }
});

// PUT /api/notes/:id — Actualizar estado DGII
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { estado_dgii, xml_path } = req.body;
        const db = getDb();

        const nota = await db.collection('notas_credito').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!nota) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        const $set = {};
        if (estado_dgii) $set.estado_dgii = estado_dgii;
        if (xml_path) $set.xml_path = xml_path;

        if (Object.keys($set).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('notas_credito').updateOne(
            { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) },
            { $set }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar nota' });
    }
});

module.exports = router;
