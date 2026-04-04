const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getNextNCF, generarCodigoSeguridad } = require('../utils/dgii');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/notes — Listar notas de credito/debito
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const notas = db.prepare(`
            SELECT nc.id, nc.fecha, nc.tipo_nota, nc.secuencia_ecf, nc.monto,
                   nc.motivo, nc.estado_dgii, nc.codigo_seguridad,
                   v.total as venta_original_total,
                   v.secuencia_ecf as secuencia_original,
                   c.nombre as cliente_nombre, c.documento as cliente_documento,
                   u.nombre as creado_por
            FROM notas_credito nc
            JOIN ventas v ON nc.venta_original_id = v.id
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON nc.user_id = u.id
            WHERE nc.negocio_id = ?
            ORDER BY nc.fecha DESC
        `).all(req.session.negocioId);

        res.json(notas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notas' });
    }
});

// POST /api/notes — Crear nota de credito/debito
router.post('/', requireAuth, (req, res) => {
    try {
        const { venta_id, motivo, monto, tipo_nota = '34' } = req.body;

        if (!venta_id || !motivo || !monto) {
            return res.status(400).json({ error: 'venta_id, motivo y monto son requeridos' });
        }

        if (!['33', '34'].includes(tipo_nota)) {
            return res.status(400).json({ error: 'tipo_nota debe ser 33 (Debito) o 34 (Credito)' });
        }

        const db = getDb();
        const negocioId = req.session.negocioId;

        const ventaOriginal = db.prepare(`
            SELECT v.id, v.total, v.subtotal, v.itbis, v.descuento, v.tipo_ecf,
                   v.secuencia_ecf, v.cliente_id, v.fecha,
                   c.nombre as cliente_nombre, c.documento as cliente_documento,
                   c.tipo_documento as cliente_tipo_doc
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.id = ? AND v.negocio_id = ?
        `).get(venta_id, negocioId);

        if (!ventaOriginal) {
            return res.status(404).json({ error: 'Venta original no encontrada' });
        }

        const secuencia = getNextNCF(db, negocioId, tipo_nota);
        const codigoSeg = generarCodigoSeguridad();
        const montoAbs = Math.abs(parseFloat(monto));

        const result = db.prepare(`
            INSERT INTO notas_credito (
                negocio_id, user_id, venta_original_id,
                tipo_nota, secuencia_ecf, codigo_seguridad,
                monto, motivo, estado_dgii, fecha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)
        `).run(
            negocioId,
            req.session.userId,
            venta_id,
            tipo_nota,
            secuencia,
            codigoSeg,
            montoAbs,
            motivo.trim(),
            getRDDateString()
        );

        res.json({
            id: result.lastInsertRowid,
            tipo_nota: tipo_nota === '34' ? 'Nota de Credito' : 'Nota de Debito',
            secuencia_ecf: secuencia,
            venta_original_id: venta_id,
            secuencia_original: ventaOriginal.secuencia_ecf,
            monto: montoAbs,
            motivo: motivo.trim()
        });
    } catch (error) {
        console.error('Error al crear nota:', error);
        res.status(500).json({ error: 'Error al crear nota: ' + error.message });
    }
});

// PUT /api/notes/:id — Actualizar estado DGII
router.put('/:id', requireAuth, (req, res) => {
    try {
        const { estado_dgii, xml_path } = req.body;
        const db = getDb();
        const nota = db.prepare('SELECT id FROM notas_credito WHERE id = ? AND negocio_id = ?')
            .get(req.params.id, req.session.negocioId);

        if (!nota) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        let query = 'UPDATE notas_credito SET ';
        const params = [];
        const updates = [];

        if (estado_dgii) { updates.push('estado_dgii = ?'); params.push(estado_dgii); }
        if (xml_path) { updates.push('xml_path = ?'); params.push(xml_path); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        query += updates.join(', ') + ' WHERE id = ?';
        params.push(req.params.id);

        db.prepare(query).run(...params);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar nota' });
    }
});

module.exports = router;
