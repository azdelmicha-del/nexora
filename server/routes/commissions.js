const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/commissions — Resumen de comisiones por empleado
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta, user_id } = req.query;

        let where = 'WHERE c.negocio_id = ?';
        const params = [negocioId];
        if (desde) { where += ' AND DATE(c.fecha) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND DATE(c.fecha) <= ?'; params.push(hasta); }
        if (user_id) { where += ' AND c.user_id = ?'; params.push(user_id); }

        // Comisiones por empleado
        const porEmpleado = db.prepare(`
            SELECT u.id as user_id, u.nombre,
                   COUNT(c.id) as total_ventas,
                   SUM(c.monto_base) as total_ventas_monto,
                   c.porcentaje,
                   SUM(c.monto_comision) as total_comision,
                   SUM(CASE WHEN c.estado = 'pendiente' THEN c.monto_comision ELSE 0 END) as comision_pendiente,
                   SUM(CASE WHEN c.estado = 'pagada' THEN c.monto_comision ELSE 0 END) as comision_pagada
            FROM comisiones c
            JOIN usuarios u ON c.user_id = u.id
            ${where}
            GROUP BY u.id, u.nombre, c.porcentaje
            ORDER BY total_comision DESC
        `).all(...params);

        // Comisiones individuales
        const comisiones = db.prepare(`
            SELECT c.*, u.nombre as empleado, v.secuencia_ecf
            FROM comisiones c
            JOIN usuarios u ON c.user_id = u.id
            LEFT JOIN ventas v ON c.venta_id = v.id
            ${where}
            ORDER BY c.fecha DESC
            LIMIT 100
        `).all(...params);

        res.json({ porEmpleado, comisiones });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener comisiones' });
    }
});

// POST /api/commissions/calcular — Calcular comisiones de un periodo
// Comision por servicio: cada servicio tiene su propio %
// Se calcula por linea de venta_detalles, no por venta total
router.post('/calcular', requireAdmin, (req, res) => {
    try {
        const { desde, hasta } = req.body;
        if (!desde || !hasta) {
            return res.status(400).json({ error: 'desde y hasta son requeridos' });
        }

        const db = getDb();
        const negocioId = req.session.negocioId;

        // Obtener cada linea de venta con su servicio y comision
        // Comisiones por servicio (usa comision_porcentaje del servicio)
        const lineasServicios = db.prepare(`
            SELECT vd.id as detalle_id, vd.venta_id, vd.servicio_id, vd.cantidad,
                   vd.precio, vd.subtotal, vd.tipo_item,
                   v.user_id, v.fecha,
                   u.nombre as empleado, u.comision_porcentaje,
                   s.nombre as servicio,
                   s.comision_porcentaje as servicio_comision
            FROM venta_detalles vd
            JOIN ventas v ON vd.venta_id = v.id
            JOIN usuarios u ON v.user_id = u.id
            LEFT JOIN servicios s ON vd.servicio_id = s.id
            WHERE v.negocio_id = ?
              AND DATE(v.fecha) >= ? AND DATE(v.fecha) <= ?
              AND v.metodo_pago != 'nota'
              AND vd.tipo_item = 'servicio'
              AND s.comision_porcentaje > 0
        `).all(negocioId, desde, hasta);

        // Comisiones por menu items (usa comision_porcentaje del empleado)
        const lineasMenu = db.prepare(`
            SELECT vd.id as detalle_id, vd.venta_id, vd.menu_item_id, vd.cantidad,
                   vd.precio, vd.subtotal, vd.tipo_item,
                   v.user_id, v.fecha,
                   u.nombre as empleado, u.comision_porcentaje,
                   m.nombre as servicio
            FROM venta_detalles vd
            JOIN ventas v ON vd.venta_id = v.id
            JOIN usuarios u ON v.user_id = u.id
            LEFT JOIN menu_items m ON vd.menu_item_id = m.id
            WHERE v.negocio_id = ?
              AND DATE(v.fecha) >= ? AND DATE(v.fecha) <= ?
              AND v.metodo_pago != 'nota'
              AND vd.tipo_item = 'menu'
              AND u.comision_porcentaje > 0
        `).all(negocioId, desde, hasta);

        const lineas = [...lineasServicios, ...lineasMenu];

        let creadas = 0;
        lineas.forEach(l => {
            // Para servicios usa la comision del servicio, para menu usa la del empleado
            const porcentaje = l.tipo_item === 'servicio'
                ? (l.servicio_comision || l.comision_porcentaje || 0)
                : (l.comision_porcentaje || 0);
            if (porcentaje <= 0) return;

            const montoComision = Math.round((l.subtotal * porcentaje / 100) * 100) / 100;
            if (montoComision <= 0) return;

            // Verificar si ya existe comision para este detalle específico
            const existente = db.prepare('SELECT id FROM comisiones WHERE detalle_id = ?').get(l.detalle_id);
            if (existente) return;

            db.prepare(`
                INSERT INTO comisiones (negocio_id, user_id, venta_id, detalle_id, monto_base, porcentaje, monto_comision, fecha)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(negocioId, l.user_id, l.venta_id, l.detalle_id, l.subtotal, porcentaje, montoComision, l.fecha);

            creadas++;
        });

        res.json({ success: true, comisiones_creadas: creadas, total_lineas: lineas.length });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al calcular comisiones' });
    }
});

// PUT /api/commissions/:id/pagar — Marcar comision como pagada
router.put('/:id/pagar', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const comision = db.prepare('SELECT id FROM comisiones WHERE id = ?').get(req.params.id);
        if (!comision) {
            return res.status(404).json({ error: 'Comision no encontrada' });
        }

        db.prepare('UPDATE comisiones SET estado = ? WHERE id = ?').run('pagada', req.params.id);
        res.json({ success: true, message: 'Comision marcada como pagada' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar comision' });
    }
});

// PUT /api/commissions/pagar-todas — Marcar todas las comisiones de un empleado como pagadas
router.put('/pagar-todas', requireAdmin, (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) {
            return res.status(400).json({ error: 'user_id es requerido' });
        }

        const db = getDb();
        const result = db.prepare(
            'UPDATE comisiones SET estado = ? WHERE user_id = ? AND estado = ?'
        ).run('pagada', user_id, 'pendiente');

        res.json({ success: true, pagadas: result.changes });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al pagar comisiones' });
    }
});

module.exports = router;
