const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { getRDDateString } = require('../utils/timezone');

const router = express.Router();

// GET /api/dashboard — Datos para el dashboard principal
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const hoy = getRDDateString();
        const mesActual = hoy.substring(0, 7); // YYYY-MM

        // Ventas hoy
        const ventasHoy = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
            FROM ventas WHERE negocio_id = ? AND DATE(fecha) = ?
        `).get(negocioId, hoy);

        // Ventas mes
        const ventasMes = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total
            FROM ventas WHERE negocio_id = ? AND strftime('%Y-%m', fecha) = ?
        `).get(negocioId, mesActual);

        // Citas hoy
        const citasHoy = db.prepare(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) as pendientes
            FROM citas WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
        `).get(negocioId, hoy);

        // Total clientes
        const totalClientes = db.prepare(
            'SELECT COUNT(*) as total FROM clientes WHERE negocio_id = ?'
        ).get(negocioId);

        // Clientes nuevos este mes
        const clientesNuevosMes = db.prepare(`
            SELECT COUNT(*) as total FROM clientes
            WHERE negocio_id = ? AND strftime('%Y-%m', fecha_registro) = ?
        `).get(negocioId, mesActual);

        // Total productos
        const totalProductos = db.prepare(
            'SELECT COUNT(*) as total FROM productos WHERE negocio_id = ?'
        ).get(negocioId);

        // Stock bajo
        const stockBajo = db.prepare(`
            SELECT COUNT(*) as total FROM productos
            WHERE negocio_id = ? AND stock <= stock_minimo AND estado = 'activo'
        `).get(negocioId);

        const stockBajoList = db.prepare(`
            SELECT nombre, stock, stock_minimo FROM productos
            WHERE negocio_id = ? AND stock <= stock_minimo AND estado = 'activo'
            ORDER BY stock ASC
            LIMIT 10
        `).all(negocioId);

        // ITBIS neto (cobrado - pagado) este mes
        const itbisCobradoMes = db.prepare(`
            SELECT COALESCE(SUM(itbis), 0) as total FROM ventas
            WHERE negocio_id = ? AND strftime('%Y-%m', fecha) = ?
        `).get(negocioId, mesActual);

        const itbisPagadoMes = db.prepare(`
            SELECT COALESCE(SUM(itbis_pagado), 0) as total FROM estado_resultado_items
            WHERE negocio_id = ? AND tipo = 'gasto' AND strftime('%Y-%m', fecha) = ?
        `).get(negocioId, mesActual);

        const itbisNeto = (itbisCobradoMes.total || 0) - (itbisPagadoMes.total || 0);

        // Comisiones pendientes
        const comisionesPendientes = db.prepare(`
            SELECT COALESCE(SUM(monto_comision), 0) as total, COUNT(DISTINCT user_id) as count
            FROM comisiones WHERE negocio_id = ? AND estado = 'pendiente'
        `).get(negocioId);

        // Ultimas ventas
        const ultimasVentas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.banco, v.fecha,
                   c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ?
            ORDER BY v.fecha DESC
            LIMIT 10
        `).all(negocioId);

        // Proximas citas
        const proximasCitas = db.prepare(`
            SELECT c.id, c.fecha, c.hora_inicio, c.estado,
                   cl.nombre as cliente, s.nombre as servicio
            FROM citas c
            JOIN clientes cl ON c.cliente_id = cl.id
            LEFT JOIN servicios s ON c.servicio_id = s.id
            WHERE c.negocio_id = ? AND c.fecha >= ? AND c.estado = 'pendiente'
            ORDER BY c.fecha ASC, c.hora_inicio ASC
            LIMIT 10
        `).all(negocioId, hoy);

        // Resultado del mes
        const resultadoMes = (ventasMes.total || 0) - 
            (db.prepare(`
                SELECT COALESCE(SUM(monto), 0) as total FROM estado_resultado_items
                WHERE negocio_id = ? AND tipo = 'gasto' AND strftime('%Y-%m', fecha) = ?
            `).get(negocioId, mesActual).total || 0);

        res.json({
            ventasHoy: ventasHoy.total || 0,
            ventasHoyCount: ventasHoy.count || 0,
            ventasMes: ventasMes.total || 0,
            citasHoy: citasHoy.total || 0,
            citasHoyPendientes: citasHoy.pendientes || 0,
            totalClientes: totalClientes.total || 0,
            clientesNuevosMes: clientesNuevosMes.total || 0,
            totalProductos: totalProductos.total || 0,
            stockBajo: stockBajo.total || 0,
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
