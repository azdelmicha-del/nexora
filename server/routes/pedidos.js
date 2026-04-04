const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Pedidos (panel admin) ───────────────────────────────────────────────────

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { estado } = req.query;
        let where = 'WHERE p.negocio_id = ?';
        const params = [req.session.negocioId];
        if (estado) { where += ' AND p.estado = ?'; params.push(estado); }

        const pedidos = db.prepare(`
            SELECT p.*,
                   (SELECT COUNT(*) FROM pedidos_items WHERE pedido_id = p.id) as items_count,
                   v.secuencia_ecf as venta_ecf
            FROM pedidos p
            LEFT JOIN ventas v ON p.venta_id = v.id
            ${where}
            ORDER BY p.fecha_creacion DESC
        `).all(...params);

        // Detalle de items para cada pedido
        pedidos.forEach(p => {
            p.items = db.prepare(`
                SELECT pi.id, pi.nombre_item, pi.cantidad, pi.precio, pi.subtotal, mi.imagen
                FROM pedidos_items pi
                LEFT JOIN menu_items mi ON pi.menu_item_id = mi.id
                WHERE pi.pedido_id = ?
            `).all(p.id);
        });

        res.json(pedidos);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener pedidos' });
    }
});

// PUT /api/pedidos/:id/estado — Cambiar estado
router.put('/:id/estado', requireAuth, (req, res) => {
    try {
        const { estado } = req.body;
        const validos = ['pendiente', 'confirmado', 'preparando', 'listo', 'entregado', 'cancelado'];
        if (!estado || !validos.includes(estado)) {
            return res.status(400).json({ error: 'Estado invalido' });
        }
        const db = getDb();
        db.prepare('UPDATE pedidos SET estado = ? WHERE id = ? AND negocio_id = ?')
            .run(estado, req.params.id, req.session.negocioId);
        res.json({ success: true, estado });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// PUT /api/pedidos/:id — Editar pedido
router.put('/:id', requireAuth, (req, res) => {
    try {
        const { cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, notas } = req.body;
        const db = getDb();
        const updates = [];
        const params = [];
        if (cliente_nombre !== undefined) { updates.push('cliente_nombre = ?'); params.push(cliente_nombre); }
        if (cliente_telefono !== undefined) { updates.push('cliente_telefono = ?'); params.push(cliente_telefono || null); }
        if (cliente_direccion !== undefined) { updates.push('cliente_direccion = ?'); params.push(cliente_direccion || null); }
        if (cliente_ubicacion !== undefined) { updates.push('cliente_ubicacion = ?'); params.push(cliente_ubicacion || null); }
        if (tipo_entrega !== undefined) { updates.push('tipo_entrega = ?'); params.push(tipo_entrega); }
        if (notas !== undefined) { updates.push('notas = ?'); params.push(notas || null); }
        if (updates.length === 0) return res.status(400).json({ error: 'No hay campos' });
        params.push(req.params.id, req.session.negocioId);
        db.prepare(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`).run(...params);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar pedido' });
    }
});

// POST /api/pedidos/:id/facturar — Facturar pedido (crear venta)
router.post('/:id/facturar', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND negocio_id = ?').get(req.params.id, negocioId);
        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
        if (pedido.estado === 'cancelado') return res.status(400).json({ error: 'Pedido cancelado' });
        if (pedido.venta_id) return res.status(400).json({ error: 'Pedido ya facturado' });

        // Crear cliente si no existe
        let clienteId = null;
        if (pedido.cliente_telefono) {
            const existente = db.prepare('SELECT id FROM clientes WHERE negocio_id = ? AND telefono = ?').get(negocioId, pedido.cliente_telefono);
            if (existente) {
                clienteId = existente.id;
            } else {
                const result = db.prepare('INSERT INTO clientes (negocio_id, nombre, telefono) VALUES (?, ?, ?)')
                    .run(negocioId, pedido.cliente_nombre, pedido.cliente_telefono);
                clienteId = result.lastInsertRowid;
            }
        }

        // Calcular ITBIS por item del menu
        const itemsPedido = db.prepare('SELECT * FROM pedidos_items WHERE pedido_id = ?').all(pedido.id);
        let subtotal = 0;
        let totalItbis = 0;
        itemsPedido.forEach(ip => {
            const menuItem = db.prepare('SELECT itbis_tasa FROM menu_items WHERE id = ?').get(ip.menu_item_id);
            const tasa = (menuItem && menuItem.itbis_tasa !== null) ? menuItem.itbis_tasa : 18;
            const itbisItem = Math.round(ip.subtotal * (tasa / 100) * 100) / 100;
            subtotal += ip.subtotal;
            totalItbis += itbisItem;
        });

        const total = subtotal + totalItbis + (pedido.costo_envio || 0) - (pedido.descuento || 0);

        // Crear venta
        const ventaResult = db.prepare(`
            INSERT INTO ventas (negocio_id, cliente_id, user_id, total, subtotal, itbis, descuento, metodo_pago, tipo_ecf, fecha)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', '32', ?)
        `).run(negocioId, clienteId, req.session.userId, total, subtotal, totalItbis, pedido.descuento || 0, pedido.fecha);

        // Crear detalles de venta con tipo_item='menu' y menu_item_id
        itemsPedido.forEach(ip => {
            const menuItem = db.prepare('SELECT itbis_tasa FROM menu_items WHERE id = ?').get(ip.menu_item_id);
            const tasa = (menuItem && menuItem.itbis_tasa !== null) ? menuItem.itbis_tasa : 18;
            const itbisItem = Math.round(ip.subtotal * (tasa / 100) * 100) / 100;
            db.prepare(`
                INSERT INTO venta_detalles (venta_id, servicio_id, menu_item_id, tipo_item, cantidad, precio, subtotal, itbis_monto)
                VALUES (?, NULL, ?, 'menu', ?, ?, ?, ?)
            `).run(ventaResult.lastInsertRowid, ip.menu_item_id, ip.cantidad, ip.precio, ip.subtotal, itbisItem);
        });

        // Vincular pedido con venta
        db.prepare('UPDATE pedidos SET venta_id = ? WHERE id = ?').run(ventaResult.lastInsertRowid, pedido.id);

        const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaResult.lastInsertRowid);
        res.json({ success: true, venta });
    } catch (error) {
        console.error('Error al facturar pedido:', error);
        res.status(500).json({ error: 'Error al facturar pedido: ' + error.message });
    }
});

// ── Pedidos (pagina publica del cliente) ────────────────────────────────────

router.post('/public/:negocioSlug', (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT id, telefono FROM negocios WHERE slug = ?').get(req.params.negocioSlug);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const { cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, items, notas } = req.body;
        if (!cliente_nombre || !items || items.length === 0) {
            return res.status(400).json({ error: 'Nombre e items requeridos' });
        }

        let subtotal = 0;
        let totalItbis = 0;
        const itemsData = [];

        for (const item of items) {
            const menuItem = db.prepare('SELECT id, nombre, precio, itbis_tasa FROM menu_items WHERE id = ? AND negocio_id = ? AND disponible = 1')
                .get(item.menu_item_id, negocio.id);
            if (!menuItem) return res.status(400).json({ error: `Item "${item.nombre}" no disponible` });

            const cantidad = parseInt(item.cantidad) || 1;
            const itemSubtotal = menuItem.precio * cantidad;
            const tasa = menuItem.itbis_tasa || 18;
            const itbisItem = Math.round(itemSubtotal * (tasa / 100) * 100) / 100;

            subtotal += itemSubtotal;
            totalItbis += itbisItem;
            itemsData.push({ menu_item_id: menuItem.id, nombre: menuItem.nombre, cantidad, precio: menuItem.precio, subtotal: itemSubtotal });
        }

        const costoEnvio = tipo_entrega === 'domicilio' ? (db.prepare('SELECT delivery_costo FROM negocios WHERE id = ?').get(negocio.id).delivery_costo || 0) : 0;
        const total = subtotal + totalItbis + costoEnvio;

        const pedidoResult = db.prepare(`
            INSERT INTO pedidos (negocio_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, costo_envio, subtotal, itbis, total, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(negocio.id, cliente_nombre, cliente_telefono || null, cliente_direccion || null, cliente_ubicacion || null, tipo_entrega || 'domicilio', costoEnvio, subtotal, totalItbis, total, notas || null);

        itemsData.forEach(item => {
            db.prepare(`
                INSERT INTO pedidos_items (pedido_id, menu_item_id, nombre_item, cantidad, precio, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(pedidoResult.lastInsertRowid, item.menu_item_id, item.nombre, item.cantidad, item.precio, item.subtotal);
        });

        res.json({
            success: true,
            pedido_id: pedidoResult.lastInsertRowid,
            subtotal,
            itbis: totalItbis,
            costo_envio: costoEnvio,
            total,
            negocio_telefono: negocio.telefono || null
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/pedidos/public/:negocioSlug/menu — Menu publico
router.get('/public/:negocioSlug/menu', (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT id, nombre, telefono, delivery_activo, delivery_costo, delivery_tiempo, delivery_minimo FROM negocios WHERE slug = ?').get(req.params.negocioSlug);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const categorias = db.prepare(`
            SELECT mc.*, COUNT(mi.id) as items_count
            FROM menu_categorias mc
            LEFT JOIN menu_items mi ON mi.categoria_id = mc.id AND mi.disponible = 1
            WHERE mc.negocio_id = ? AND mc.activa = 1
            GROUP BY mc.id
            ORDER BY mc.orden ASC
        `).all(negocio.id);

        const items = db.prepare(`
            SELECT mi.*, mc.nombre as categoria_nombre
            FROM menu_items mi
            LEFT JOIN menu_categorias mc ON mi.categoria_id = mc.id
            WHERE mi.negocio_id = ? AND mi.disponible = 1
            ORDER BY mi.destacado DESC, mi.nombre ASC
        `).all(negocio.id);

        res.json({ negocio: { ...negocio, slug: req.params.negocioSlug }, categorias, items });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener menu' });
    }
});

module.exports = router;
