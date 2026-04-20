const express = require('express');
const { getDb, getNextNCF } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { round2, validateDocumento, generarCodigoSeguridad, calcularTotalesVenta } = require('../utils/dgii');
const { getRDTimestamp, getRDDateString, getRDDate } = require('../utils/timezone');
const QRCode = require('qrcode');

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
        const { cliente_id, items, metodo_pago, descuento, banco, tipo_ecf, origen_modulo, origen_id } = req.body;

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

        const tipoECF = tipo_ecf || '32';
        const origenModulo = origen_modulo || 'pos';
        const origenId = origen_id ? Number.parseInt(origen_id, 10) : null;

        if (!['pos', 'cita', 'pedido'].includes(origenModulo)) {
            return res.status(400).json({ error: 'Origen de venta invalido' });
        }
        if (origen_id != null && (!Number.isInteger(origenId) || origenId <= 0)) {
            return res.status(400).json({ error: 'origen_id invalido' });
        }

        const db = getDb();

        if (origenModulo === 'pedido' && origenId) {
            const pedido = db.prepare('SELECT id, estado, venta_id FROM pedidos WHERE id = ? AND negocio_id = ?')
                .get(origenId, req.session.negocioId);
            if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado para facturar' });
            if (!['confirmado', 'entregado'].includes(pedido.estado)) {
                return res.status(400).json({ error: 'El pedido debe estar confirmado o entregado para facturar' });
            }
            if (pedido.venta_id) return res.status(400).json({ error: 'Este pedido ya esta facturado' });
        }

        if (origenModulo === 'cita' && origenId) {
            const cita = db.prepare('SELECT id, estado FROM citas WHERE id = ? AND negocio_id = ?')
                .get(origenId, req.session.negocioId);
            if (!cita) return res.status(404).json({ error: 'Cita no encontrada para facturar' });
            if (cita.estado === 'cancelada') return res.status(400).json({ error: 'No se puede facturar una cita cancelada' });
        }

        // Validar cliente y RNC si es Crédito Fiscal
        let clienteDoc = null;
        if (cliente_id) {
            const cliente = db.prepare('SELECT id, nombre, documento, tipo_documento FROM clientes WHERE id = ? AND negocio_id = ?')
                .get(cliente_id, req.session.negocioId);
            if (!cliente) {
                return res.status(400).json({ error: 'Cliente no válido' });
            }
            clienteDoc = cliente;
            
            // Crédito Fiscal (E31) requiere RNC/Cédula válido
            if (tipoECF === '31') {
                const validacion = validateDocumento(cliente.documento);
                if (!validacion.valid) {
                    return res.status(400).json({ error: 'Crédito Fiscal requiere RNC (9 dígitos) o Cédula (11 dígitos) válidos del cliente' });
                }
            }
        } else if (tipoECF === '31') {
            return res.status(400).json({ error: 'Crédito Fiscal requiere un cliente con RNC/Cédula válido' });
        }
        
        // La caja siempre está abierta para nuevas ventas
        // No verificamos cajas_cerradas porque el historial se mantiene aparte

        const fechaLocal = getRDTimestamp();

        // ── Calcular totales con ITBIS individual por servicio ─────────────────
        // calcularTotalesVenta lee la itbis_tasa de cada servicio desde la DB,
        // valida que existan y distribuye el descuento proporcionalmente por línea.
        let totales;
        try {
            totales = calcularTotalesVenta(items, db, req.session.negocioId, descuento || 0);
        } catch (calcError) {
            return res.status(400).json({ error: calcError.message });
        }

        if (descuento && (descuento < 0 || descuento > totales.subtotal)) {
            return res.status(400).json({ error: 'El descuento debe estar entre 0 y el total' });
        }

        const subtotalVenta  = totales.subtotal;
        const descuentoMonto = totales.descuento;
        const itbisVenta     = totales.total_itbis;
        const totalFinal     = totales.total_general;
        
        // Generar secuencia NCF y código de seguridad
        const secuenciaECF = getNextNCF(req.session.negocioId, tipoECF);
        const codigoSeguridad = generarCodigoSeguridad();
        
        const ventaResult = db.prepare(`
            INSERT INTO ventas (negocio_id, cliente_id, user_id, total, subtotal, itbis, descuento, metodo_pago, banco, fuera_cuadre, tipo_ecf, secuencia_ecf, codigo_seguridad, estado_dgii, fecha, origen_modulo, origen_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pendiente', ?, ?, ?)
        `).run(
            req.session.negocioId,
            cliente_id || null,
            req.session.userId,
            totalFinal,
            subtotalVenta,
            itbisVenta,
            round2(descuento || 0),
            metodo_pago,
            banco || null,
            tipoECF,
            secuenciaECF,
            codigoSeguridad,
            fechaLocal,
            origenModulo,
            origenId
        );

        const ventaId = ventaResult.lastInsertRowid;

        // ── Insertar detalles usando los datos ya calculados por calcularTotalesVenta
        // itbis_monto queda congelado en el valor del momento de la venta.
        // Si la tasa del servicio cambia después, las facturas históricas no se alteran.
        const stmtDetalle = db.prepare(`
            INSERT INTO venta_detalles (venta_id, servicio_id, producto_id, menu_item_id, tipo_item, cantidad, precio, subtotal, itbis_monto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const linea of totales.lineas) {
            stmtDetalle.run(
                ventaId,
                linea.servicio_id || null,
                linea.producto_id || null,
                linea.menu_item_id || null,
                linea.tipo_item || 'servicio',
                linea.cantidad,
                linea.precio,
                linea.subtotal,
                linea.itbis_monto
            );

            // Descontar stock si es producto
            if (linea.tipo_item === 'producto' && linea.producto_id) {
                db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?')
                    .run(linea.cantidad, linea.producto_id);
                db.prepare(`
                    INSERT INTO movimientos_inventario (negocio_id, producto_id, tipo, cantidad, costo_unitario, referencia, user_id)
                    VALUES (?, ?, 'venta', ?, ?, ?, ?)
                `).run(
                    req.session.negocioId,
                    linea.producto_id,
                    linea.cantidad,
                    0,
                    'Venta #' + ventaId,
                    req.session.userId
                );
            }
        }

        db.prepare(`
            INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
            VALUES (?, 'venta', ?, ?)
        `).run(req.session.negocioId, `Nueva venta registrada`, ventaId);

        if (origenModulo === 'pedido' && origenId) {
            db.prepare('UPDATE pedidos SET venta_id = ?, estado = ?, fecha_entregado = COALESCE(fecha_entregado, ?) WHERE id = ? AND negocio_id = ?')
                .run(ventaId, 'entregado', fechaLocal, origenId, req.session.negocioId);
        }
        if (origenModulo === 'cita' && origenId) {
            db.prepare('UPDATE citas SET estado = ? WHERE id = ? AND negocio_id = ?')
                .run('finalizada', origenId, req.session.negocioId);
        }

        // ── Lealtad: 1 punto por cada RD$100 gastado ─────────────────────
        if (cliente_id && totalFinal > 0) {
            const puntosGanados = Math.floor(totalFinal / 100);
            if (puntosGanados > 0) {
                const plExistente = db.prepare('SELECT id, puntos FROM puntos_lealtad WHERE negocio_id = ? AND cliente_id = ?').get(req.session.negocioId, cliente_id);
                if (plExistente) {
                    const nuevosPuntos = plExistente.puntos + puntosGanados;
                    const nivel = nuevosPuntos >= 5000 ? 'platino' : nuevosPuntos >= 2000 ? 'oro' : nuevosPuntos >= 500 ? 'plata' : 'bronce';
                    db.prepare('UPDATE puntos_lealtad SET puntos = ?, nivel = ?, ultima_actividad = ? WHERE id = ?')
                        .run(nuevosPuntos, nivel, getRDDateString(), plExistente.id);
                } else {
                    const nivel = puntosGanados >= 5000 ? 'platino' : puntosGanados >= 2000 ? 'oro' : puntosGanados >= 500 ? 'plata' : 'bronce';
                    db.prepare('INSERT INTO puntos_lealtad (negocio_id, cliente_id, puntos, nivel, ultima_actividad) VALUES (?, ?, ?, ?, ?)')
                        .run(req.session.negocioId, cliente_id, puntosGanados, nivel, getRDDateString());
                }
                db.prepare('INSERT INTO historial_puntos (negocio_id, cliente_id, puntos, tipo, referencia) VALUES (?, ?, ?, ?, ?)')
                    .run(req.session.negocioId, cliente_id, puntosGanados, 'ganado', 'Venta #' + ventaId);
            }
        }

        // ── Auditoria ────────────────────────────────────────────────────
        try {
            db.prepare(`
                INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
                VALUES (?, ?, 'POST', 'ventas', ?, ?, ?, ?)
            `).run(
                req.session.negocioId, req.session.userId, ventaId,
                'Venta #' + ventaId + ' - ' + formatCurrency(totalFinal),
                req.ip, req.headers['user-agent']
            );
        } catch (e) { /* no bloquear */ }

        const venta = db.prepare(`
            SELECT v.id, v.total, v.subtotal, v.itbis, v.descuento, v.metodo_pago, v.banco, v.fecha, v.fuera_cuadre,
                   v.tipo_ecf, v.secuencia_ecf, v.codigo_seguridad, v.estado_dgii,
                   c.nombre as cliente, c.documento as cliente_documento
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.id = ?
        `).get(ventaId);

        res.json(venta);
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ error: 'Error al procesar la venta: ' + (error.message || error) });
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
            SELECT v.id, v.total, v.subtotal, v.itbis, v.descuento, v.metodo_pago, v.banco, v.fecha,
                   v.tipo_ecf, v.secuencia_ecf, v.estado_dgii,
                   c.id as cliente_id, c.nombre as cliente, c.documento as cliente_documento, u.nombre as usuario
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            JOIN usuarios u ON v.user_id = u.id
            WHERE v.id = ? AND v.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const detalles = db.prepare(`
            SELECT vd.id, vd.cantidad, vd.precio, vd.subtotal, vd.itbis_monto,
                   vd.tipo_item,
                   COALESCE(s.nombre, p.nombre, m.nombre) as servicio,
                   COALESCE(s.itbis_tasa, p.itbis_tasa, m.itbis_tasa, 18) as itbis_tasa
            FROM venta_detalles vd
            LEFT JOIN servicios s ON vd.servicio_id = s.id
            LEFT JOIN productos p ON vd.producto_id = p.id
            LEFT JOIN menu_items m ON vd.menu_item_id = m.id
            WHERE vd.venta_id = ?
        `).all(req.params.id);

        res.json({ ...venta, detalles });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener venta' });
    }
});

// Generar y descargar XML e-CF
router.get('/:id/xml', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const path = require('path');
        const fs = require('fs');
        const { generarXMLVenta } = require('../utils/xml-generator');
        
        const venta = db.prepare(`
            SELECT v.*, c.nombre as cliente, c.documento as cliente_documento
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.id = ? AND v.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);
        
        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        
        const negocio = db.prepare('SELECT * FROM negocios WHERE id = ?').get(req.session.negocioId);
        const detalles = db.prepare(`
            SELECT vd.cantidad, vd.precio, vd.subtotal, s.nombre as servicio
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id
            WHERE vd.venta_id = ?
        `).all(req.params.id);
        
        const cliente = venta.cliente_documento ? { nombre: venta.cliente, documento: venta.cliente_documento } : null;
        const xml = generarXMLVenta(venta, negocio, cliente, detalles);
        
        // Guardar XML en la DB
        db.prepare('UPDATE ventas SET xml_generado = ? WHERE id = ?').run(xml, req.params.id);
        
        // Guardar copia en /facturas_electronicas/{negocio_id}/
        const dirPath = path.join(__dirname, '..', 'facturas_electronicas', String(req.session.negocioId));
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        const fileName = `${venta.secuencia_ecf || `venta-${venta.id}`}.xml`;
        fs.writeFileSync(path.join(dirPath, fileName), xml, 'utf8');
        
        // Cambiar estado a 'firmado'
        db.prepare("UPDATE ventas SET estado_dgii = 'firmado' WHERE id = ?").run(req.params.id);
        
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(xml);
    } catch (error) {
        console.error('Error generando XML:', error);
        res.status(500).json({ error: 'Error al generar XML: ' + error.message });
    }
});

// Datos para QR fiscal
router.get('/:id/qr', requireAuth, (req, res) => {
    try {
        const db = getDb();
        
        const venta = db.prepare(`
            SELECT v.id, v.total, v.secuencia_ecf, v.fecha, v.tipo_ecf, v.codigo_seguridad,
                   n.rnc as rnc_negocio, n.nombre as nombre_negocio
            FROM ventas v
            JOIN negocios n ON v.negocio_id = n.id
            WHERE v.id = ? AND v.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);
        
        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }
        
        // Datos para el QR según formato DGII
        const qrData = {
            rnc_emisor: venta.rnc_negocio || '',
            rnc_comprador: '',
            ecf: venta.secuencia_ecf || `E${venta.tipo_ecf || '32'}${String(venta.id).padStart(10, '0')}`,
            fecha: venta.fecha,
            total: venta.total,
            codigo_seguridad: venta.codigo_seguridad || ''
        };
        
        res.json(qrData);
    } catch (error) {
        console.error('Error QR:', error);
        res.status(500).json({ error: 'Error al obtener datos QR' });
    }
});

router.get('/resumen/dia', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const hoy = getRDDateString();

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

// ── Nota de Credito (34) y Nota de Debito (33) ─────────────────────────────
// Permite anular o corregir facturas emitidas, requisito DGII
router.post('/nota-credito', requireAuth, (req, res) => {
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

        // Verificar que la venta original existe y pertenece al negocio
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

        // Generar NCF para la nota (33 o 34)
        const secuencia = getNextNCF(db, negocioId, tipo_nota);
        const codigoSeg = generarCodigoSeguridad();
        const montoAbs = Math.abs(parseFloat(monto));

        // Crear registro en tabla notas_credito
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

// Listar notas de credito/debito
router.get('/notas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const notas = db.prepare(`
            SELECT nc.id, nc.fecha, nc.tipo_nota, nc.secuencia_ecf, nc.monto,
                   nc.motivo, nc.estado_dgii,
                   v.total as venta_original_total,
                   v.secuencia_ecf as secuencia_original,
                   c.nombre as cliente_nombre
            FROM notas_credito nc
            JOIN ventas v ON nc.venta_original_id = v.id
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE nc.negocio_id = ?
            ORDER BY nc.fecha DESC
        `).all(req.session.negocioId);

        res.json(notas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notas' });
    }
});

module.exports = router;
