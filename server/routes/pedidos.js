const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { round2 } = require('../utils/dgii');
const { getRDTimestamp } = require('../utils/timezone');
const { toTitleCase } = require('../utils/validators');
const { upsertCanonicalClient, normalizeCanonicalClientInput } = require('../utils/client-canonical');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function isClientValidationError(message) {
    if (!message) return false;
    return /requerido|telefono|celular|email|documento|tipo_documento/i.test(message);
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
                   COALESCE(c.nombre, p.cliente_nombre) as cliente_nombre_master,
                   (SELECT COUNT(*) FROM pedidos_items WHERE pedido_id = p.id) as items_count,
                   v.secuencia_ecf as venta_ecf
            FROM pedidos p
            LEFT JOIN clientes c ON p.cliente_id = c.id AND c.negocio_id = p.negocio_id
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

        let clienteIdFinal = pedido.cliente_id || null;
        if (estado === 'entregado' && !clienteIdFinal && pedido.cliente_nombre && pedido.cliente_telefono) {
            const cliente = upsertCanonicalClient(
                db,
                req.session.negocioId,
                {
                    nombre: pedido.cliente_nombre,
                    telefono: pedido.cliente_telefono,
                    notas: pedido.notas
                },
                { requireName: true, requirePhone: true, createIfMissing: true, updateMissingFields: true }
            );
            clienteIdFinal = cliente ? cliente.id : null;
        }

        const ahora = getRDTimestamp();
        const campoEstado = {
            confirmado: 'fecha_confirmado',
            preparando: 'fecha_preparando',
            listo: 'fecha_listo',
            entregado: 'fecha_entregado',
            cancelado: 'fecha_cancelado'
        }[estado];

        const updates = ['estado = ?'];
        const updateParams = [estado];
        if (clienteIdFinal && !pedido.cliente_id) {
            updates.push('cliente_id = ?');
            updateParams.push(clienteIdFinal);
        }
        if (campoEstado) {
            updates.push(`${campoEstado} = ?`);
            updateParams.push(ahora);
        }
        updateParams.push(req.params.id, req.session.negocioId);

        db.prepare(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`)
            .run(...updateParams);

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
        if (isClientValidationError(error.message)) {
            return res.status(400).json({ error: error.message });
        }
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
        if (cliente_telefono !== undefined) {
            if (cliente_telefono) {
                const canon = normalizeCanonicalClientInput({ telefono: cliente_telefono }, { requirePhone: true });
                updates.push('cliente_telefono = ?');
                params.push(canon.telefono);
            } else {
                updates.push('cliente_telefono = ?');
                params.push(null);
            }
        }
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
        if (isClientValidationError(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al actualizar pedido' });
    }
});

// DELETE /api/pedidos/finalizados?estado=entregado|cancelado — Limpiar pedidos finalizados
router.delete('/finalizados', requireAuth, (req, res) => {
    try {
        const estado = req.query.estado;
        const permitidos = ['entregado', 'cancelado'];
        let estados = permitidos;

        if (estado) {
            if (!permitidos.includes(estado)) {
                return res.status(400).json({ error: 'Estado invalido para limpieza' });
            }
            estados = [estado];
        }

        const db = getDb();
        const placeholders = estados.map(() => '?').join(',');
        const params = [req.session.negocioId, ...estados];

        const limpiar = db.transaction(() => {
            db.prepare(`
                DELETE FROM pedidos_items
                WHERE pedido_id IN (
                    SELECT id FROM pedidos
                    WHERE negocio_id = ? AND estado IN (${placeholders})
                )
            `).run(...params);

            const result = db.prepare(`
                DELETE FROM pedidos
                WHERE negocio_id = ? AND estado IN (${placeholders})
            `).run(...params);

            return result.changes || 0;
        });

        const eliminados = limpiar();

        db.prepare(`
            INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
            VALUES (?, ?, 'DELETE', 'pedidos', NULL, ?, ?, ?)
        `).run(
            req.session.negocioId,
            req.session.userId,
            `Limpieza de pedidos finalizados (${estados.join(',')}): ${eliminados}`,
            req.ip,
            req.headers['user-agent'] || ''
        );

        res.json({ success: true, eliminados, estados });
    } catch (error) {
        console.error('Error al limpiar pedidos finalizados:', error);
        res.status(500).json({ error: 'Error al limpiar pedidos finalizados' });
    }
});

// GET /api/pedidos/:id/checkout-data — Datos para cobrar en POS
router.get('/:id/checkout-data', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const pedidoId = parseInt(req.params.id, 10);
        const pedido = db.prepare(`
            SELECT id, estado, venta_id, cliente_id, cliente_nombre, cliente_telefono, subtotal, descuento, itbis, total
            FROM pedidos
            WHERE id = ? AND negocio_id = ?
        `)
            .get(pedidoId, req.session.negocioId);

        if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
        if (pedido.estado === 'cancelado') return res.status(400).json({ error: 'No se puede facturar un pedido cancelado' });
        if (!['confirmado', 'entregado'].includes(pedido.estado)) {
            return res.status(400).json({ error: 'Solo se puede enviar a POS un pedido confirmado o entregado' });
        }
        if (pedido.venta_id) return res.status(400).json({ error: 'Este pedido ya fue facturado' });

        const items = db.prepare(`
            SELECT menu_item_id, nombre_item, cantidad, precio, subtotal
            FROM pedidos_items
            WHERE pedido_id = ?
            ORDER BY id ASC
        `).all(pedidoId);

        res.json({
            success: true,
            pedido: {
                id: pedido.id,
                estado: pedido.estado,
                cliente_id: pedido.cliente_id,
                cliente_nombre: pedido.cliente_nombre,
                cliente_telefono: pedido.cliente_telefono,
                subtotal: pedido.subtotal,
                descuento: pedido.descuento,
                itbis: pedido.itbis,
                total: pedido.total
            },
            items
        });
    } catch (error) {
        console.error('Error al preparar checkout de pedido:', error);
        res.status(500).json({ error: 'Error al preparar checkout de pedido: ' + error.message });
    }
});

// ── Pedidos (pagina publica del cliente) ────────────────────────────────────

router.post('/public/:negocioSlug', (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare(`
            SELECT id, telefono, delivery_activo, delivery_costo, delivery_tiempo, delivery_minimo
            FROM negocios WHERE slug = ?
        `).get(req.params.negocioSlug);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const { cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, cliente_tipo_documento, cliente_documento, tipo_entrega, items, notas, descuento } = req.body;
        if (!cliente_nombre || !cliente_telefono || !items || items.length === 0) {
            return res.status(400).json({ error: 'Nombre, celular e items requeridos' });
        }

        const entregaTipo = tipo_entrega || 'domicilio';
        const esDomicilio = entregaTipo === 'domicilio';

        if (esDomicilio && !negocio.delivery_activo) {
            return res.status(400).json({ error: 'El negocio no tiene delivery habilitado' });
        }

        if (esDomicilio && !cliente_direccion?.trim()) {
            return res.status(400).json({ error: 'La dirección es obligatoria para pedidos a domicilio' });
        }

        // Crear o buscar cliente
        const cliente = upsertCanonicalClient(
            db,
            negocio.id,
            {
                nombre: cliente_nombre,
                telefono: cliente_telefono,
                notas,
                tipo_documento: cliente_tipo_documento,
                documento: cliente_documento
            },
            { requireName: true, requirePhone: true, createIfMissing: true, updateMissingFields: true }
        );
        const clienteId = cliente ? cliente.id : null;

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
            const tasa = (menuItem.itbis_tasa !== null && menuItem.itbis_tasa !== undefined)
                ? menuItem.itbis_tasa
                : 18;
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

        const deliveryMinimo = Math.max(0, parseFloat(negocio.delivery_minimo) || 0);
        if (esDomicilio && subtotal < deliveryMinimo) {
            return res.status(400).json({ error: `El pedido mínimo para delivery es RD$${deliveryMinimo.toFixed(2)}. Seleccione más pedidos para poder pedir a domicilio.` });
        }

        const costoEnvio = esDomicilio ? (parseFloat(negocio.delivery_costo) || 0) : 0;
        const total = subtotal + totalItbis + costoEnvio - descuentoVal;

        // Get next sequential number for this negocio
        const maxNum = db.prepare('SELECT COALESCE(MAX(numero_pedido), 0) as max_num FROM pedidos WHERE negocio_id = ?').get(negocio.id);
        const numeroPedido = maxNum.max_num + 1;

        const fechaPedido = getRDTimestamp();
        const pedidoResult = db.prepare(`
            INSERT INTO pedidos (negocio_id, cliente_id, cliente_nombre, cliente_telefono, cliente_direccion, cliente_ubicacion, tipo_entrega, costo_envio, subtotal, descuento, itbis, total, notas, numero_pedido, fecha, fecha_creacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            negocio.id,
            clienteId,
            toTitleCase(cliente_nombre),
            cliente_telefono || null,
            cliente_direccion || null,
            cliente_ubicacion || null,
            entregaTipo,
            costoEnvio,
            subtotal,
            descuentoVal,
            totalItbis,
            total,
            notas || null,
            numeroPedido,
            fechaPedido,
            fechaPedido
        );

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
        if (isClientValidationError(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al crear pedido' });
    }
});

// GET /api/pedidos/public/:negocioSlug/menu — Menu publico
router.get('/public/:negocioSlug/menu', (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT id, nombre, telefono, logo, delivery_activo, delivery_costo, delivery_tiempo, delivery_minimo FROM negocios WHERE slug = ?').get(req.params.negocioSlug);
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
