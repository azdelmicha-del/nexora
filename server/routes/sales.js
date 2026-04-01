const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/config', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT metodo_efectivo, metodo_transferencia, metodo_tarjeta, activar_descuentos FROM negocios WHERE id = ?')
            .get(req.session.negocioId);
        
        // La caja siempre está abierta para nuevas ventas
        // El historial de cierres se mantiene para consulta
        res.json({
            ...config,
            caja_cerrada: false
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { cliente_id, items, metodo_pago, descuento, banco } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Debe agregar al menos un servicio' });
        }

        if (!metodo_pago) {
            return res.status(400).json({ error: 'Seleccione un método de pago' });
        }

        const metodosValidos = ['efectivo', 'transferencia', 'tarjeta'];
        if (!metodosValidos.includes(metodo_pago)) {
            return res.status(400).json({ error: 'Método de pago inválido' });
        }

        const db = getDb();
        
        // La caja siempre está abierta para nuevas ventas
        // No verificamos cajas_cerradas porque el historial se mantiene aparte

        let total = 0;
        for (const item of items) {
            const servicio = db.prepare('SELECT precio FROM servicios WHERE id = ? AND negocio_id = ? AND estado = ?')
                .get(item.servicio_id, req.session.negocioId, 'activo');
            if (!servicio) {
                return res.status(400).json({ error: `Servicio ID ${item.servicio_id} no válido` });
            }
            total += servicio.precio * (item.cantidad || 1);
        }

        if (descuento && (descuento < 0 || descuento > total)) {
            return res.status(400).json({ error: 'El descuento debe estar entre 0 y el total' });
        }

        const totalFinal = total - (descuento || 0);

        if (cliente_id) {
            const cliente = db.prepare('SELECT id FROM clientes WHERE id = ? AND negocio_id = ?')
                .get(cliente_id, req.session.negocioId);
            if (!cliente) {
                return res.status(400).json({ error: 'Cliente no válido' });
            }
        }

        const ahora = new Date();
        const fechaLocal = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}:${String(ahora.getSeconds()).padStart(2, '0')}`;
        
        const ventaResult = db.prepare(`
            INSERT INTO ventas (negocio_id, cliente_id, user_id, total, descuento, metodo_pago, banco, fuera_cuadre, fecha)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
            req.session.negocioId,
            cliente_id || null,
            req.session.userId,
            totalFinal,
            descuento || 0,
            metodo_pago,
            banco || null,
            fechaLocal
        );

        const ventaId = ventaResult.lastInsertRowid;

        for (const item of items) {
            const servicio = db.prepare('SELECT precio FROM servicios WHERE id = ? AND negocio_id = ?')
                .get(item.servicio_id, req.session.negocioId);
            if (!servicio) {
                return res.status(400).json({ error: 'Servicio no válido' });
            }
            const cantidad = item.cantidad || 1;
            const subtotal = Math.round(servicio.precio * cantidad * 100) / 100;

            db.prepare(`
                INSERT INTO venta_detalles (venta_id, servicio_id, cantidad, precio, subtotal)
                VALUES (?, ?, ?, ?, ?)
            `).run(ventaId, item.servicio_id, cantidad, servicio.precio, subtotal);
        }

        db.prepare(`
            INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
            VALUES (?, 'venta', ?, ?)
        `).run(req.session.negocioId, `Nueva venta registrada`, ventaId);

        const venta = db.prepare(`
            SELECT v.id, v.total, v.descuento, v.metodo_pago, v.banco, v.fecha, v.fuera_cuadre,
                   c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.id = ?
        `).get(ventaId);

        res.json(venta);
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ error: 'Error al procesar la venta' });
    }
});

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { fecha, cliente, metodo } = req.query;

        let query = `
            SELECT v.id, v.total, v.descuento, v.metodo_pago, v.banco, v.fecha,
                   c.nombre as cliente, u.nombre as usuario
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.user_id = u.id
            WHERE v.negocio_id = ?
        `;
        const params = [req.session.negocioId];

        if (fecha) {
            query += ' AND DATE(v.fecha) = ?';
            params.push(fecha);
        }

        if (cliente) {
            query += ' AND c.nombre LIKE ?';
            params.push(`%${cliente}%`);
        }

        if (metodo) {
            query += ' AND v.metodo_pago = ?';
            params.push(metodo);
        }

        query += ' ORDER BY v.fecha DESC LIMIT 100';

        const ventas = db.prepare(query).all(...params);
        res.json(ventas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener ventas' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        
        const venta = db.prepare(`
            SELECT v.id, v.total, v.descuento, v.metodo_pago, v.banco, v.fecha,
                   c.id as cliente_id, c.nombre as cliente, u.nombre as usuario
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.user_id = u.id
            WHERE v.id = ? AND v.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const detalles = db.prepare(`
            SELECT vd.id, vd.cantidad, vd.precio, vd.subtotal,
                   s.nombre as servicio
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id
            WHERE vd.venta_id = ?
        `).all(req.params.id);

        res.json({ ...venta, detalles });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener venta' });
    }
});

router.get('/resumen/dia', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const hoy = new Date().toISOString().split('T')[0];

        const ventas = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad,
                   SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END) as efectivo,
                   SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END) as transferencia,
                   SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END) as tarjeta
            FROM ventas
            WHERE negocio_id = ? AND DATE(fecha) = ?
        `).get(req.session.negocioId, hoy);

        res.json(ventas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

module.exports = router;
