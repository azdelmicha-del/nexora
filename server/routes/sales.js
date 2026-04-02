const express = require('express');
const { getDb, getNextNCF } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { round2, validateDocumento, generarCodigoSeguridad } = require('../utils/dgii');

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
        const { cliente_id, items, metodo_pago, descuento, banco, tipo_ecf } = req.body;

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

        const db = getDb();

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

        const ahora = new Date();
        const fechaLocal = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}:${String(ahora.getSeconds()).padStart(2, '0')}`;

        let total = 0;
        for (const item of items) {
            const servicio = db.prepare('SELECT precio FROM servicios WHERE id = ? AND negocio_id = ? AND estado = ?')
                .get(item.servicio_id, req.session.negocioId, 'activo');
            if (!servicio) {
                return res.status(400).json({ error: `Servicio ID ${item.servicio_id} no válido` });
            }
            total = round2(total + round2(servicio.precio * (item.cantidad || 1)));
        }

        if (descuento && (descuento < 0 || descuento > total)) {
            return res.status(400).json({ error: 'El descuento debe estar entre 0 y el total' });
        }

        const subtotalVenta = round2(total);
        const descuentoMonto = round2(descuento || 0);
        const baseImponible = round2(subtotalVenta - descuentoMonto);
        const itbisVenta = round2(baseImponible * 0.18);
        const totalFinal = round2(baseImponible + itbisVenta);
        
        // Generar secuencia NCF y código de seguridad
        const secuenciaECF = getNextNCF(req.session.negocioId, tipoECF);
        const codigoSeguridad = generarCodigoSeguridad();
        
        const ventaResult = db.prepare(`
            INSERT INTO ventas (negocio_id, cliente_id, user_id, total, subtotal, itbis, descuento, metodo_pago, banco, fuera_cuadre, tipo_ecf, secuencia_ecf, codigo_seguridad, estado_dgii, fecha)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pendiente', ?)
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
            const subtotal = round2(servicio.precio * cantidad);

            db.prepare(`
                INSERT INTO venta_detalles (venta_id, servicio_id, cantidad, precio, subtotal)
                VALUES (?, ?, ?, ?, ?)
            `).run(ventaId, item.servicio_id, cantidad, round2(servicio.precio), subtotal);
        }

        db.prepare(`
            INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
            VALUES (?, 'venta', ?, ?)
        `).run(req.session.negocioId, `Nueva venta registrada`, ventaId);

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
