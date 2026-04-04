const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { round2, generarCodigoSeguridad } = require('../utils/dgii');
const { getNextNCF } = require('../database');
const { getRDDateString, getRDDate } = require('../utils/timezone');
const { toTitleCase } = require('../utils/validators');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function crearClienteSiNoExiste(db, negocioId, nombre, telefono) {
    if (!telefono) return null;
    // Normalizar telefono: solo digitos
    const telClean = telefono.replace(/\D/g, '');
    if (telClean.length < 10) return null;

    // Buscar por telefono normalizado
    const existente = db.prepare(
        "SELECT id FROM clientes WHERE negocio_id = ? AND REPLACE(REPLACE(REPLACE(telefono, '-', ''), ' ', ''), '+', '') LIKE ?"
    ).get(negocioId, '%' + telClean.substring(telClean.length - 10));

    if (existente) return existente.id;

    // Crear nuevo cliente con validacion minima
    const result = db.prepare(
        'INSERT INTO clientes (negocio_id, nombre, telefono) VALUES (?, ?, ?)'
    ).run(negocioId, toTitleCase(nombre), telClean);

    return result.lastInsertRowid;
}

function awardLoyaltyPoints(db, negocioId, clienteId, total) {
    if (!clienteId || total <= 0) return;
    const puntosGanados = Math.floor(total / 100);
    if (puntosGanados <= 0) return;

    const existente = db.prepare('SELECT id, puntos FROM puntos_lealtad WHERE negocio_id = ? AND cliente_id = ?').get(negocioId, clienteId);
    if (existente) {
        const nuevosPuntos = existente.puntos + puntosGanados;
        const nivel = nuevosPuntos >= 5000 ? 'platino' : nuevosPuntos >= 2000 ? 'oro' : nuevosPuntos >= 500 ? 'plata' : 'bronce';
        db.prepare('UPDATE puntos_lealtad SET puntos = ?, nivel = ?, ultima_actividad = ? WHERE id = ?')
            .run(nuevosPuntos, nivel, getRDDateString(), existente.id);
    } else {
        const nivel = puntosGanados >= 5000 ? 'platino' : puntosGanados >= 2000 ? 'oro' : puntosGanados >= 500 ? 'plata' : 'bronce';
        db.prepare('INSERT INTO puntos_lealtad (negocio_id, cliente_id, puntos, nivel, ultima_actividad) VALUES (?, ?, ?, ?, ?)')
            .run(negocioId, clienteId, puntosGanados, nivel, getRDDateString());
    }
    db.prepare('INSERT INTO historial_puntos (negocio_id, cliente_id, puntos, tipo, referencia) VALUES (?, ?, ?, ?, ?)')
        .run(negocioId, clienteId, puntosGanados, 'ganado', 'Pedido facturado');
}

function sendWhatsAppOnStatus(db, negocioId, pedido) {
    const config = db.prepare('SELECT * FROM whatsapp_config WHERE negocio_id = ? AND activo = 1').get(negocioId);
    if (!config || !config.token || !config.phone_number_id) return;

    const tel = (pedido.cliente_telefono || '').replace(/\D/g, '');
    if (tel.length < 10) return;

    const messages = {
        confirmado: `Hola ${pedido.cliente_nombre}, tu pedido #${pedido.id} ha sido confirmado. Total: RD$${pedido.total.toFixed(2)}. Te avisaremos cuando este listo.`,
        preparando: `Hola ${pedido.cliente_nombre}, tu pedido #${pedido.id} esta siendo preparado. Pronto estara listo.`,
        listo: `Hola ${pedido.cliente_nombre}, tu pedido #${pedido.id} esta listo para ${pedido.tipo_entrega === 'domicilio' ? 'entrega' : 'retiro'}.`,
        entregado: `Hola ${pedido.cliente_nombre}, tu pedido #${pedido.id} ha sido entregado. Gracias por tu compra!`,
        cancelado: `Hola ${pedido.cliente_nombre}, tu pedido #${pedido.id} ha sido cancelado. Si tienes alguna duda, contactanos.`
    };

    const msg = messages[pedido.estado];
    if (!msg) return;

    fetch(`https://graph.facebook.com/v17.0/${config.phone_number_id}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: '1' + tel,
            type: 'text',
            text: { body: msg }
        })
    }).catch(e => console.error('WhatsApp error:', e.message));
}

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
        const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND negocio_id = ?').get(req.params.id, req.session.negocioId);
        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

        db.prepare('UPDATE pedidos SET estado = ? WHERE id = ? AND negocio_id = ?')
            .run(estado, req.params.id, req.session.negocioId);

        // Auto-facturar cuando se marca como entregado
        if (estado === 'entregado' && !pedido.venta_id) {
            // Disparar facturación en background
            setTimeout(() => {
                try {
                    const fetch = require('node-fetch');
                    // No podemos hacer fetch aqui sin auth, mejor facturar directamente
                    facturarPedidoDirecto(db, req.session.negocioId, req.session.userId, pedido.id);
                } catch (e) {
                    console.error('Auto-facturar error:', e.message);
                }
            }, 500);
        }

        // Enviar WhatsApp notification
        pedido.estado = estado;
        sendWhatsAppOnStatus(db, req.session.negocioId, pedido);

        // Audit log
        db.prepare(`
            INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
            VALUES (?, ?, 'UPDATE', 'pedidos', ?, ?, ?, ?)
        `).run(req.session.negocioId, req.session.userId, req.params.id, 'Estado cambiado a: ' + estado, req.ip, req.headers['user-agent'] || '');

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
        if (cliente_nombre !== undefined) { updates.push('cliente_nombre = ?'); params.push(toTitleCase(cliente_nombre)); }
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

// ── Facturacion directa (usada por auto-facturar y endpoint manual) ──────────

function facturarPedidoDirecto(db, negocioId, userId, pedidoId) {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND negocio_id = ?').get(pedidoId, negocioId);
    if (!pedido || pedido.estado === 'cancelado' || pedido.venta_id) return null;

    // Crear o buscar cliente
    let clienteId = crearClienteSiNoExiste(db, negocioId, pedido.cliente_nombre, pedido.cliente_telefono);

    // Calcular ITBIS con round2
    const itemsPedido = db.prepare('SELECT * FROM pedidos_items WHERE pedido_id = ?').all(pedido.id);
    let subtotal = 0;
    let totalItbis = 0;
    itemsPedido.forEach(ip => {
        const menuItem = db.prepare('SELECT itbis_tasa FROM menu_items WHERE id = ?').get(ip.menu_item_id);
        const tasa = (menuItem && menuItem.itbis_tasa !== null) ? menuItem.itbis_tasa : 18;
        const descuentoProp = pedido.descuento > 0 ? (ip.subtotal / pedido.subtotal) * pedido.descuento : 0;
        const baseLinea = ip.subtotal - descuentoProp;
        const itbisItem = round2(baseLinea * (tasa / 100));
        subtotal += ip.subtotal;
        totalItbis += itbisItem;
    });

    const descuento = pedido.descuento || 0;
    const total = subtotal + totalItbis + (pedido.costo_envio || 0) - descuento;

    // Generar NCF
    const secuencia = getNextNCF(db, negocioId, '32');
    const codigoSeg = generarCodigoSeguridad();

    // Crear venta
    const ventaResult = db.prepare(`
        INSERT INTO ventas (negocio_id, cliente_id, user_id, total, subtotal, itbis, descuento, metodo_pago, tipo_ecf, secuencia_ecf, codigo_seguridad, fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', '32', ?, ?, ?)
    `).run(negocioId, clienteId, userId, total, subtotal, totalItbis, descuento, secuencia, codigoSeg, getRDDate().toISOString());

    // Crear detalles
    itemsPedido.forEach(ip => {
        const menuItem = db.prepare('SELECT itbis_tasa FROM menu_items WHERE id = ?').get(ip.menu_item_id);
        const tasa = (menuItem && menuItem.itbis_tasa !== null) ? menuItem.itbis_tasa : 18;
        const descuentoProp = descuento > 0 ? (ip.subtotal / subtotal) * descuento : 0;
        const baseLinea = ip.subtotal - descuentoProp;
        const itbisItem = round2(baseLinea * (tasa / 100));
        db.prepare(`
            INSERT INTO venta_detalles (venta_id, servicio_id, menu_item_id, tipo_item, cantidad, precio, subtotal, itbis_monto)
            VALUES (?, NULL, ?, 'menu', ?, ?, ?, ?)
        `).run(ventaResult.lastInsertRowid, ip.menu_item_id, ip.cantidad, ip.precio, ip.subtotal, itbisItem);
    });

    // Vincular pedido con venta
    db.prepare('UPDATE pedidos SET venta_id = ? WHERE id = ?').run(ventaResult.lastInsertRowid, pedido.id);

    // Notification
    db.prepare(`
        INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
        VALUES (?, 'venta', ?, ?)
    `).run(negocioId, 'Pedido #' + pedido.id + ' facturado: ' + secuencia, ventaResult.lastInsertRowid);

    // Audit log
    db.prepare(`
        INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
        VALUES (?, ?, 'POST', 'ventas', ?, ?, '', '')
    `).run(negocioId, userId, ventaResult.lastInsertRowid, 'Venta desde pedido #' + pedido.id + ' — ' + secuencia);

    // Loyalty points
    awardLoyaltyPoints(db, negocioId, clienteId, total);

    return db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaResult.lastInsertRowid);
}

// POST /api/pedidos/:id/facturar — Facturar pedido (crear venta)
router.post('/:id/facturar', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const venta = facturarPedidoDirecto(db, req.session.negocioId, req.session.userId, parseInt(req.params.id));
        if (!venta) return res.status(400).json({ error: 'No se pudo facturar el pedido' });
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

        const { cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, items, notas, descuento } = req.body;
        if (!cliente_nombre || !items || items.length === 0) {
            return res.status(400).json({ error: 'Nombre e items requeridos' });
        }

        // Crear o buscar cliente
        const clienteId = crearClienteSiNoExiste(db, negocio.id, cliente_nombre, cliente_telefono);

        let subtotal = 0;
        let totalItbis = 0;
        const itemsData = [];
        const descuentoVal = Math.max(0, parseFloat(descuento) || 0);

        for (const item of items) {
            const menuItem = db.prepare('SELECT id, nombre, precio, itbis_tasa FROM menu_items WHERE id = ? AND negocio_id = ? AND disponible = 1')
                .get(item.menu_item_id, negocio.id);
            if (!menuItem) return res.status(400).json({ error: `Item "${item.nombre}" no disponible` });

            const cantidad = parseInt(item.cantidad) || 1;
            const itemSubtotal = menuItem.precio * cantidad;
            const tasa = menuItem.itbis_tasa || 18;
            // Distribuir descuento proporcionalmente antes de calcular ITBIS
            const descuentoProp = descuentoVal > 0 ? (itemSubtotal / (items.reduce((s, i) => {
                const mi = db.prepare('SELECT precio FROM menu_items WHERE id = ?').get(i.menu_item_id);
                return s + (mi ? mi.precio * (parseInt(i.cantidad) || 1) : 0);
            }, 0))) * descuentoVal : 0;
            const baseLinea = itemSubtotal - descuentoProp;
            const itbisItem = round2(baseLinea * (tasa / 100));

            subtotal += itemSubtotal;
            totalItbis += itbisItem;
            itemsData.push({ menu_item_id: menuItem.id, nombre: menuItem.nombre, cantidad, precio: menuItem.precio, subtotal: itemSubtotal });
        }

        const costoEnvio = tipo_entrega === 'domicilio' ? (db.prepare('SELECT delivery_costo FROM negocios WHERE id = ?').get(negocio.id).delivery_costo || 0) : 0;
        const total = subtotal + totalItbis + costoEnvio - descuentoVal;

        // Get next sequential number for this negocio
        const maxNum = db.prepare('SELECT COALESCE(MAX(numero_pedido), 0) as max_num FROM pedidos WHERE negocio_id = ?').get(negocio.id);
        const numeroPedido = maxNum.max_num + 1;

        const pedidoResult = db.prepare(`
            INSERT INTO pedidos (negocio_id, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, costo_envio, subtotal, descuento, itbis, total, notas, numero_pedido)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(negocio.id, clienteId, toTitleCase(cliente_nombre), cliente_telefono || null, cliente_direccion || null, cliente_ubicacion || null, tipo_entrega || 'domicilio', costoEnvio, subtotal, descuentoVal, totalItbis, total, notas || null, numeroPedido);

        itemsData.forEach(item => {
            db.prepare(`
                INSERT INTO pedidos_items (pedido_id, menu_item_id, nombre_item, cantidad, precio, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(pedidoResult.lastInsertRowid, item.menu_item_id, item.nombre, item.cantidad, item.precio, item.subtotal);
        });

        res.json({
            success: true,
            pedido_id: pedidoResult.lastInsertRowid,
            numero_pedido: numeroPedido,
            subtotal,
            descuento: descuentoVal,
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
