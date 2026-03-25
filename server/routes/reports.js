const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/ventas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;
        const hoy = new Date().toISOString().split('T')[0];

        const cajaCerrada = db.prepare(`
            SELECT id FROM cajas_cerradas WHERE negocio_id = ? AND fecha = ?
        `).get(negocioId, hoy);

        let where = 'WHERE v.negocio_id = ?';
        const params = [negocioId];

        if (desde) {
            where += ' AND DATE(v.fecha) >= ?';
            params.push(desde);
        }

        if (hasta) {
            where += ' AND DATE(v.fecha) <= ?';
            params.push(hasta);
        }

        if (cajaCerrada && (!desde || desde <= hoy) && (!hasta || hasta >= hoy)) {
            where += ' AND DATE(v.fecha) < ?';
            params.push(hoy);
        }

        const resumen = db.prepare(`
            SELECT 
                COUNT(*) as total_ventas,
                COALESCE(SUM(v.total), 0) as monto_total,
                COALESCE(AVG(v.total), 0) as promedio_venta
            FROM ventas v
            ${where}
        `).get(...params);

        const porMetodo = db.prepare(`
            SELECT 
                metodo_pago,
                COUNT(*) as cantidad,
                COALESCE(SUM(total), 0) as monto
            FROM ventas v
            ${where}
            GROUP BY metodo_pago
        `).all(...params);

        const porDia = db.prepare(`
            SELECT 
                DATE(v.fecha) as fecha,
                COUNT(*) as cantidad,
                COALESCE(SUM(v.total), 0) as monto
            FROM ventas v
            ${where}
            GROUP BY DATE(v.fecha)
            ORDER BY fecha DESC
            LIMIT 30
        `).all(...params);

        const ultimasVentas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            ${where}
            ORDER BY v.fecha DESC
            LIMIT 20
        `).all(...params);

        res.json({
            resumen,
            porMetodo,
            porDia,
            ultimasVentas,
            caja_cerrada: !!cajaCerrada
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de ventas' });
    }
});

router.get('/servicios', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;
        const hoy = new Date().toISOString().split('T')[0];

        const cajaCerrada = db.prepare(`
            SELECT id FROM cajas_cerradas WHERE negocio_id = ? AND fecha = ?
        `).get(negocioId, hoy);

        let where = 'WHERE v.negocio_id = ?';
        const params = [negocioId];

        if (desde) {
            where += ' AND DATE(v.fecha) >= ?';
            params.push(desde);
        }

        if (hasta) {
            where += ' AND DATE(v.fecha) <= ?';
            params.push(hasta);
        }

        if (cajaCerrada && (!desde || desde <= hoy) && (!hasta || hasta >= hoy)) {
            where += ' AND DATE(v.fecha) < ?';
            params.push(hoy);
        }

        const topServicios = db.prepare(`
            SELECT 
                s.id,
                s.nombre,
                s.precio,
                COUNT(vd.id) as veces_vendido,
                COALESCE(SUM(vd.subtotal), 0) as ingreso_total
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id AND s.negocio_id = ?
            JOIN ventas v ON vd.venta_id = v.id
            ${where}
            GROUP BY s.id, s.nombre, s.precio
            ORDER BY veces_vendido DESC
            LIMIT 20
        `).all(negocioId, ...params);

        const porCategoria = db.prepare(`
            SELECT 
                COALESCE(c.nombre, 'Sin categoría') as categoria,
                COUNT(vd.id) as veces_vendido,
                COALESCE(SUM(vd.subtotal), 0) as ingreso_total
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id AND s.negocio_id = ?
            LEFT JOIN categorias c ON s.categoria_id = c.id
            JOIN ventas v ON vd.venta_id = v.id
            ${where}
            GROUP BY c.id, c.nombre
            ORDER BY ingreso_total DESC
        `).all(negocioId, ...params);

        const totalServicios = db.prepare(`
            SELECT 
                COUNT(DISTINCT s.id) as servicios_vendidos,
                COALESCE(SUM(vd.subtotal), 0) as ingreso_total
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id AND s.negocio_id = ?
            JOIN ventas v ON vd.venta_id = v.id
            ${where}
        `).get(negocioId, ...params);

        res.json({
            topServicios,
            porCategoria,
            totalServicios,
            caja_cerrada: !!cajaCerrada
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de servicios' });
    }
});

router.get('/clientes', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;

        let whereFecha = '';
        const paramsFecha = [];

        if (desde) {
            whereFecha = ' AND DATE(c.fecha_registro) >= ?';
            paramsFecha.push(desde);
        }

        if (hasta) {
            whereFecha += ' AND DATE(c.fecha_registro) <= ?';
            paramsFecha.push(hasta);
        }

        const resumen = db.prepare(`
            SELECT 
                COUNT(*) as total_clientes,
                SUM(CASE WHEN DATE(c.fecha_registro) >= DATE('now', '-30 days') THEN 1 ELSE 0 END) as nuevos_mes,
                SUM(CASE WHEN EXISTS (
                    SELECT 1 FROM ventas v WHERE v.cliente_id = c.id AND v.negocio_id = ?
                ) THEN 1 ELSE 0 END) as con_compras
            FROM clientes c
            WHERE c.negocio_id = ?${whereFecha}
        `).get(negocioId, negocioId, ...paramsFecha);

        const masFrecuentes = db.prepare(`
            SELECT c.id, c.nombre, c.telefono,
                   COUNT(v.id) as total_compras,
                   COALESCE(SUM(v.total), 0) as total_gastado
            FROM clientes c
            LEFT JOIN ventas v ON c.id = v.cliente_id AND v.negocio_id = ?
            WHERE c.negocio_id = ?
            GROUP BY c.id, c.nombre, c.telefono
            ORDER BY total_compras DESC
            LIMIT 10
        `).all(negocioId, negocioId);

        res.json({
            resumen,
            masFrecuentes
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de clientes' });
    }
});

router.get('/citas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;

        let where = 'WHERE cit.negocio_id = ?';
        const params = [negocioId];

        if (desde) {
            where += ' AND DATE(cit.fecha) >= ?';
            params.push(desde);
        }

        if (hasta) {
            where += ' AND DATE(cit.fecha) <= ?';
            params.push(hasta);
        }

        const resumen = db.prepare(`
            SELECT 
                COUNT(*) as total_citas,
                SUM(CASE WHEN cit.estado = 'finalizada' THEN 1 ELSE 0 END) as finalizadas,
                SUM(CASE WHEN cit.estado = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
                SUM(CASE WHEN cit.estado IN ('pendiente', 'confirmada') THEN 1 ELSE 0 END) as pendientes
            FROM citas cit
            ${where}
        `).get(...params);

        const porDia = db.prepare(`
            SELECT 
                DATE(cit.fecha) as fecha,
                COUNT(*) as total,
                SUM(CASE WHEN cit.estado = 'finalizada' THEN 1 ELSE 0 END) as finalizadas
            FROM citas cit
            ${where}
            GROUP BY DATE(cit.fecha)
            ORDER BY fecha DESC
            LIMIT 30
        `).all(...params);

        const masSolicitados = db.prepare(`
            SELECT 
                s.nombre,
                COUNT(cit.id) as cantidad
            FROM citas cit
            JOIN servicios s ON cit.servicio_id = s.id
            ${where}
            GROUP BY s.id
            ORDER BY cantidad DESC
            LIMIT 10
        `).all(...params);

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

router.get('/cuadre', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const hoy = new Date().toISOString().split('T')[0];

        const cajaCerrada = db.prepare(`
            SELECT id FROM cajas_cerradas
            WHERE negocio_id = ? AND fecha = ?
        `).get(req.session.negocioId, hoy);

        const resumen = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0) as efectivo,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0) as transferencia,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0) as tarjeta,
                   MIN(DATE(fecha)) as primera_venta,
                   MAX(DATE(fecha)) as ultima_venta,
                   MIN(fecha) as hora_inicio,
                   MAX(fecha) as hora_fin
            FROM ventas
            WHERE negocio_id = ? AND DATE(fecha) = ?
        `).get(req.session.negocioId, hoy);

        const resumenFueraCuadre = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad
            FROM ventas
            WHERE negocio_id = ? AND DATE(fecha) = ? AND fuera_cuadre = 1
        `).get(req.session.negocioId, hoy);

        const ventas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.fecha, v.fuera_cuadre, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ? AND DATE(v.fecha) = ?
            ORDER BY v.fecha ASC
        `).all(req.session.negocioId, hoy);

        const ventasConDetalles = ventas.map(venta => {
            const detalles = db.prepare(`
                SELECT vd.cantidad, vd.precio, vd.subtotal, s.nombre as servicio
                FROM venta_detalles vd
                LEFT JOIN servicios s ON vd.servicio_id = s.id
                WHERE vd.venta_id = ?
            `).all(venta.id);
            
            return {
                ...venta,
                detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
            };
        });

        res.json({
            resumen,
            resumenFueraCuadre,
            ventas: ventasConDetalles,
            fecha: hoy,
            caja_cerrada: !!cajaCerrada
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener cuadre' });
    }
});

router.post('/cuadre/cerrar', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const hoy = new Date().toISOString().split('T')[0];

        const existente = db.prepare(`
            SELECT id FROM cajas_cerradas
            WHERE negocio_id = ? AND fecha = ?
        `).get(req.session.negocioId, hoy);

        if (existente) {
            return res.status(400).json({ error: 'La caja ya fue cerrada hoy' });
        }

        const resumen = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0) as efectivo,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0) as transferencia,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0) as tarjeta
            FROM ventas
            WHERE negocio_id = ? AND DATE(fecha) = ?
        `).get(req.session.negocioId, hoy);

        if (resumen.cantidad === 0) {
            return res.status(400).json({ error: 'No hay ventas registradas hoy para cerrar la caja' });
        }

        const result = db.prepare(`
            INSERT INTO cajas_cerradas (negocio_id, fecha, total, cantidad_ventas, efectivo, transferencia, tarjeta, user_id, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            hoy,
            resumen.total,
            resumen.cantidad,
            resumen.efectivo,
            resumen.transferencia,
            resumen.tarjeta,
            req.session.userId,
            req.body.notas || null
        );

        const cierreId = result.lastInsertRowid;

        const ventasDelDia = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ? AND DATE(v.fecha) = ?
            ORDER BY v.fecha ASC
        `).all(req.session.negocioId, hoy);

        const ventasConDetalles = ventasDelDia.map(venta => {
            const detalles = db.prepare(`
                SELECT vd.cantidad, vd.precio, s.nombre as servicio
                FROM venta_detalles vd
                LEFT JOIN servicios s ON vd.servicio_id = s.id
                WHERE vd.venta_id = ?
            `).all(venta.id);
            
            return {
                ...venta,
                detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
            };
        });

        res.json({
            success: true,
            mensaje: 'Caja cerrada correctamente',
            cierreId,
            resumen,
            ventas: ventasConDetalles
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al cerrar caja' });
    }
});

router.post('/cuadre/abrir', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const hoy = new Date().toISOString().split('T')[0];

        const existente = db.prepare(`
            SELECT id FROM cajas_cerradas
            WHERE negocio_id = ? AND fecha = ?
        `).get(req.session.negocioId, hoy);

        if (!existente) {
            return res.status(400).json({ error: 'La caja no está cerrada' });
        }

        db.prepare('DELETE FROM cajas_cerradas WHERE id = ?').run(existente.id);

        res.json({ success: true, mensaje: 'Caja abierta correctamente' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al abrir caja' });
    }
});

router.get('/cuadre/historial', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();

        // Solo mostrar cuadres de los últimos 7 días
        const hace7dias = new Date();
        hace7dias.setDate(hace7dias.getDate() - 7);
        const fechaMin = hace7dias.toISOString().split('T')[0];

        const historial = db.prepare(`
            SELECT cc.*, u.nombre as usuario
            FROM cajas_cerradas cc
            JOIN usuarios u ON cc.user_id = u.id
            WHERE cc.negocio_id = ? AND cc.fecha >= ?
            ORDER BY cc.fecha DESC
        `).all(req.session.negocioId, fechaMin);

        res.json(historial);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});

router.get('/cuadre/detalles/:fecha', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const fecha = req.params.fecha;

        const cierre = db.prepare(`
            SELECT cc.*, u.nombre as usuario
            FROM cajas_cerradas cc
            JOIN usuarios u ON cc.user_id = u.id
            WHERE cc.negocio_id = ? AND cc.fecha = ?
        `).get(req.session.negocioId, fecha);

        if (!cierre) {
            return res.status(404).json({ error: 'No se encontró cierre para esta fecha' });
        }

        const ventas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ? AND DATE(v.fecha) = ?
            ORDER BY v.fecha ASC
        `).all(req.session.negocioId, fecha);

        const ventasConDetalles = ventas.map(venta => {
            const detalles = db.prepare(`
                SELECT vd.cantidad, vd.precio, s.nombre as servicio
                FROM venta_detalles vd
                LEFT JOIN servicios s ON vd.servicio_id = s.id
                WHERE vd.venta_id = ?
            `).all(venta.id);
            
            return {
                ...venta,
                detalles: detalles.map(d => `${d.servicio} x${d.cantidad}`).join(', ') || 'Venta rápida'
            };
        });

        res.json({
            cierre,
            ventas: ventasConDetalles
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener detalles' });
    }
});

router.delete('/cuadre/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();

        const caja = db.prepare(`
            SELECT id FROM cajas_cerradas
            WHERE id = ? AND negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!caja) {
            return res.status(404).json({ error: 'Cuadre no encontrado' });
        }

        db.prepare('DELETE FROM cajas_cerradas WHERE id = ?').run(req.params.id);

        res.json({ success: true, mensaje: 'Cuadre eliminado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar cuadre' });
    }
});

// Endpoint para limpiar cuadres antiguos (más de 7 días)
router.delete('/cuadre/cleanup', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - 7);
        const fechaLimiteStr = fechaLimite.toISOString().split('T')[0];

        const result = db.prepare(`
            DELETE FROM cajas_cerradas 
            WHERE negocio_id = ? AND fecha < ?
        `).run(req.session.negocioId, fechaLimiteStr);

        res.json({ 
            success: true, 
            mensaje: `Se eliminaron ${result.changes} cuadres antiguos`,
            eliminados: result.changes
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al limpiar cuadres' });
    }
});

module.exports = router;
