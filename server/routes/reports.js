const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/ventas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;
        const ahora = new Date();
        const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;

        // La caja siempre está abierta para nuevas ventas
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

        // La caja siempre está abierta - no filtrar por caja cerrada

        const resumen = db.prepare(`
            SELECT 
                COUNT(*) as total_ventas,
                COALESCE(SUM(v.total), 0)     as monto_total,
                COALESCE(SUM(v.subtotal), 0)  as subtotal_total,
                COALESCE(SUM(v.itbis), 0)     as itbis_total,
                COALESCE(SUM(v.descuento), 0) as descuento_total,
                COALESCE(AVG(v.total), 0)     as promedio_venta
            FROM ventas v
            ${where}
        `).get(...params);

        // ITBIS real desde venta_detalles.itbis_monto (calculado por servicio en Paso 3)
        // Es mas preciso que el campo itbis de ventas (ventas antiguas tienen itbis=0)
        const itbisDetalles = db.prepare(`
            SELECT COALESCE(SUM(vd.itbis_monto), 0) as itbis_real
            FROM venta_detalles vd
            JOIN ventas v ON vd.venta_id = v.id
            ${where}
        `).get(...params);

        // Usar el mayor de los dos valores (itbis_monto es correcto para ventas nuevas,
        // itbis_total puede tener datos de ventas antiguas calculadas manualmente)
        resumen.itbis_cobrado_real = Math.max(
            itbisDetalles.itbis_real || 0,
            resumen.itbis_total || 0
        );

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
            SELECT v.id, v.total, v.subtotal, v.itbis, v.descuento,
                   v.metodo_pago, v.banco, v.fecha, v.secuencia_ecf,
                   c.nombre as cliente
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
            caja_cerrada: false // Siempre abierta para nuevas ventas
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener reporte de ventas' });
    }
});

// ── Reporte Fiscal ITBIS ────────────────────────────────────────────────────
// Calcula la compensacion ITBIS (cobrado en ventas vs. pagado a suplidores)
// Fuentes de verdad:
//   ITBIS cobrado → SUM(venta_detalles.itbis_monto) [por servicio, Paso 3]
//                   con fallback a SUM(ventas.itbis) para ventas antiguas
//   ITBIS pagado  → SUM(estado_resultado_items.itbis) [campo del formulario]
//                   + SUM(estado_resultado_items.itbis_pagado) [campo NCF especifico]
router.get('/fiscal', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;

        let whereVentas = 'WHERE v.negocio_id = ?';
        let whereEgresos = 'WHERE negocio_id = ? AND tipo = \'gasto\'';
        const paramsV = [negocioId];
        const paramsE = [negocioId];

        if (desde) {
            whereVentas  += ' AND DATE(v.fecha) >= ?';
            whereEgresos += ' AND DATE(fecha) >= ?';
            paramsV.push(desde);
            paramsE.push(desde);
        }
        if (hasta) {
            whereVentas  += ' AND DATE(v.fecha) <= ?';
            whereEgresos += ' AND DATE(fecha) <= ?';
            paramsV.push(hasta);
            paramsE.push(hasta);
        }

        // ── ITBIS cobrado en ventas ─────────────────────────────────────────
        // Prioridad 1: suma desde venta_detalles.itbis_monto (ventas nuevas, Paso 3)
        const itbisDetalles = db.prepare(`
            SELECT COALESCE(SUM(vd.itbis_monto), 0) as total
            FROM venta_detalles vd
            JOIN ventas v ON vd.venta_id = v.id
            ${whereVentas}
        `).get(...paramsV);

        // Prioridad 2: suma desde ventas.itbis (ventas antiguas calculadas manualmente)
        const itbisVentas = db.prepare(`
            SELECT COALESCE(SUM(v.itbis), 0) as total
            FROM ventas v
            ${whereVentas}
        `).get(...paramsV);

        // Usar el mayor: ventas nuevas tienen itbis_monto correcto,
        // ventas viejas tienen itbis en el header de la venta
        const itbisCobrado = Math.max(
            parseFloat(itbisDetalles.total) || 0,
            parseFloat(itbisVentas.total)   || 0
        );

        // ── ITBIS pagado a suplidores ───────────────────────────────────────
        // Campo 'itbis' = ITBIS del formulario de egresos (lo que el usuario ingresa)
        // Campo 'itbis_pagado' = ITBIS especifico del NCF (campo nuevo)
        // Se suman ambos para no perder ningun dato
        const itbisEgresos = db.prepare(`
            SELECT
                COALESCE(SUM(itbis), 0)        as total_itbis_formulario,
                COALESCE(SUM(itbis_pagado), 0) as total_itbis_ncf,
                COUNT(*) as total_egresos
            FROM estado_resultado_items
            ${whereEgresos}
        `).get(...paramsE);

        // Evitar doble conteo: si itbis_pagado > 0 y itbis > 0 en el mismo egreso,
        // usamos el maximo por fila (el usuario puede haber llenado ambos)
        const itbisPorEgreso = db.prepare(`
            SELECT id, descripcion, monto, itbis, itbis_pagado, ncf_suplidor,
                   tipo_gasto, categoria, metodo_pago, fecha,
                   MAX(COALESCE(itbis, 0), COALESCE(itbis_pagado, 0)) as itbis_efectivo
            FROM estado_resultado_items
            ${whereEgresos}
            ORDER BY fecha DESC
        `).all(...paramsE);

        const itbisPagado = itbisPorEgreso.reduce(
            (sum, e) => sum + (parseFloat(e.itbis_efectivo) || 0), 0
        );

        // ── Desglose por tasa de servicios vendidos ─────────────────────────
        const porTasa = db.prepare(`
            SELECT
                s.itbis_tasa,
                COUNT(vd.id)                    as veces,
                COALESCE(SUM(vd.subtotal), 0)   as subtotal_total,
                COALESCE(SUM(vd.itbis_monto), 0) as itbis_total
            FROM venta_detalles vd
            JOIN servicios s ON vd.servicio_id = s.id AND s.negocio_id = ?
            JOIN ventas v ON vd.venta_id = v.id
            ${whereVentas}
            GROUP BY s.itbis_tasa
            ORDER BY s.itbis_tasa DESC
        `).all(negocioId, ...paramsV);

        // ── Ventas con desglose ITBIS por linea ─────────────────────────────
        const ventasDetalle = db.prepare(`
            SELECT v.id, v.fecha, v.metodo_pago, v.banco, v.total,
                   v.subtotal, v.itbis, v.descuento, v.secuencia_ecf,
                   c.nombre as cliente,
                   COALESCE(SUM(vd.itbis_monto), 0) as itbis_monto_real
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN venta_detalles vd ON vd.venta_id = v.id
            ${whereVentas}
            GROUP BY v.id
            ORDER BY v.fecha DESC
            LIMIT 50
        `).all(...paramsV);

        res.json({
            itbisCobrado:       Math.round(itbisCobrado * 100) / 100,
            itbisPagado:        Math.round(itbisPagado * 100) / 100,
            itbisNeto:          Math.round((itbisCobrado - itbisPagado) * 100) / 100,
            porTasa,
            egresos:            itbisPorEgreso,
            ventas:             ventasDetalle,
            meta: {
                itbis_de_detalles:  parseFloat(itbisDetalles.total) || 0,
                itbis_de_ventas:    parseFloat(itbisVentas.total)   || 0,
                itbis_formulario:   parseFloat(itbisEgresos.total_itbis_formulario) || 0,
                itbis_ncf:          parseFloat(itbisEgresos.total_itbis_ncf) || 0,
                total_egresos:      itbisEgresos.total_egresos
            }
        });
    } catch (error) {
        console.error('Error en reporte fiscal:', error);
        res.status(500).json({ error: 'Error al obtener reporte fiscal: ' + error.message });
    }
});

// ── Reporte 606 (Compras) — Registro de Compras para DGII ───────────────────
// Formato oficial 606: NCF, fecha, RNC suplidor, monto, ITBIS, tipo gasto
router.get('/606', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { mes, anio } = req.query;

        // Default: mes actual
        const now = new Date();
        const mesFilt = mes ? parseInt(mes) : (now.getMonth() + 1);
        const anioFilt = anio ? parseInt(anio) : now.getFullYear();

        const egresos = db.prepare(`
            SELECT
                ncf_suplidor as NCF_Documento,
                CASE tipo_gasto
                    WHEN 'insumo' THEN '01'
                    WHEN 'fijo' THEN '02'
                    WHEN 'personal' THEN '03'
                    ELSE '04'
                END as Tipo_Gasto,
                fecha as Fecha_Comprobante,
                COALESCE(ncf_suplidor, 'N/A') as RNC_Suplidor,
                descripcion as Detalle,
                subtotal as Monto_Sin_ITBIS,
                COALESCE(itbis, 0) as ITBIS,
                COALESCE(descuento, 0) as Descuento,
                monto as Total
            FROM estado_resultado_items
            WHERE negocio_id = ?
              AND tipo = 'gasto'
              AND ncf_suplidor IS NOT NULL
              AND strftime('%m', fecha) = ?
              AND strftime('%Y', fecha) = ?
            ORDER BY fecha ASC
        `).all(negocioId, String(mesFilt).padStart(2, '0'), String(anioFilt));

        res.json({
            tipo: '606',
            mes: mesFilt,
            anio: anioFilt,
            registros: egresos,
            totales: {
                monto_sin_itbis: egresos.reduce((s, e) => s + (e.Monto_Sin_ITBIS || 0), 0),
                itbis: egresos.reduce((s, e) => s + (e.ITBIS || 0), 0),
                descuento: egresos.reduce((s, e) => s + (e.Descuento || 0), 0),
                total: egresos.reduce((s, e) => s + (e.Total || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error en 606:', error);
        res.status(500).json({ error: 'Error al generar reporte 606' });
    }
});

// ── Reporte 607 (Ventas) — Registro de Ventas para DGII ─────────────────────
// Formato oficial 607: NCF, fecha, RNC cliente, monto, ITBIS, tipo
router.get('/607', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { mes, anio } = req.query;

        const now = new Date();
        const mesFilt = mes ? parseInt(mes) : (now.getMonth() + 1);
        const anioFilt = anio ? parseInt(anio) : now.getFullYear();

        const ventas = db.prepare(`
            SELECT
                v.secuencia_ecf as NCF,
                v.fecha as Fecha_Comprobante,
                COALESCE(c.documento, '') as RNC_Cedula,
                COALESCE(c.nombre, 'CONSUMIDOR FINAL') as Nombre_Cliente,
                v.subtotal as Monto_Sin_ITBIS,
                COALESCE(v.itbis, 0) as ITBIS,
                COALESCE(v.descuento, 0) as Descuento,
                v.total as Total,
                CASE v.tipo_ecf
                    WHEN '31' THEN '01'
                    WHEN '32' THEN '02'
                    WHEN '33' THEN '03'
                    WHEN '34' THEN '04'
                    ELSE '02'
                END as Tipo_Ingresos
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ?
              AND strftime('%m', v.fecha) = ?
              AND strftime('%Y', v.fecha) = ?
              AND v.estado_dgii != 'anulada'
            ORDER BY v.fecha ASC
        `).all(negocioId, String(mesFilt).padStart(2, '0'), String(anioFilt));

        res.json({
            tipo: '607',
            mes: mesFilt,
            anio: anioFilt,
            registros: ventas,
            totales: {
                monto_sin_itbis: ventas.reduce((s, v) => s + (v.Monto_Sin_ITBIS || 0), 0),
                itbis: ventas.reduce((s, v) => s + (v.ITBIS || 0), 0),
                descuento: ventas.reduce((s, v) => s + (v.Descuento || 0), 0),
                total: ventas.reduce((s, v) => s + (v.Total || 0), 0)
            }
        });
    } catch (error) {
        console.error('Error en 607:', error);
        res.status(500).json({ error: 'Error al generar reporte 607' });
    }
});

// ── Exportar Ventas a CSV ───────────────────────────────────────────────────
router.get('/export/ventas', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;

        let where = 'WHERE v.negocio_id = ?';
        const params = [negocioId];
        if (desde) { where += ' AND DATE(v.fecha) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND DATE(v.fecha) <= ?'; params.push(hasta); }

        const ventas = db.prepare(`
            SELECT v.id, v.fecha, v.total, v.subtotal, v.itbis, v.descuento,
                   v.metodo_pago, v.banco, v.tipo_ecf, v.secuencia_ecf,
                   c.nombre as cliente, c.documento as cliente_doc,
                   u.nombre as vendedor
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            LEFT JOIN usuarios u ON v.user_id = u.id
            ${where}
            ORDER BY v.fecha DESC
        `).all(...params);

        const headers = ['ID','Fecha','Cliente','Documento','Vendedor','Metodo Pago','Banco','Tipo ECF','NCF','Subtotal','ITBIS','Descuento','Total'];
        const rows = ventas.map(v => [
            v.id, v.fecha, v.cliente || 'Consumidor Final', v.cliente_doc || '',
            v.vendedor || '', v.metodo_pago, v.banco || '', v.tipo_ecf, v.secuencia_ecf || '',
            v.subtotal, v.itbis, v.descuento, v.total
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ventas_${desde || 'todo'}_${hasta || 'hoy'}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export CSV:', error);
        res.status(500).json({ error: 'Error al exportar' });
    }
});

// ── Exportar Egresos a CSV ──────────────────────────────────────────────────
router.get('/export/egresos', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;

        let where = 'WHERE negocio_id = ? AND tipo = ?';
        const params = [negocioId, 'gasto'];
        if (desde) { where += ' AND DATE(fecha) >= ?'; params.push(desde); }
        if (hasta) { where += ' AND DATE(fecha) <= ?'; params.push(hasta); }

        const egresos = db.prepare(`
            SELECT id, fecha, categoria, subtipo, descripcion, subtotal, itbis,
                   descuento, monto, metodo_pago, ncf_suplidor, itbis_pagado, tipo_gasto, notas
            FROM estado_resultado_items
            ${where}
            ORDER BY fecha DESC
        `).all(...params);

        const headers = ['ID','Fecha','Categoria','Subtipo','Descripcion','Subtotal','ITBIS','Descuento','Total','Metodo Pago','NCF Suplidor','ITBIS Pagado','Tipo Gasto','Notas'];
        const rows = egresos.map(e => [
            e.id, e.fecha, e.categoria, e.subtipo || '', e.descripcion,
            e.subtotal, e.itbis, e.descuento, e.monto, e.metodo_pago,
            e.ncf_suplidor || '', e.itbis_pagado || 0, e.tipo_gasto || '', e.notas || ''
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="egresos_${desde || 'todo'}_${hasta || 'hoy'}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export CSV:', error);
        res.status(500).json({ error: 'Error al exportar' });
    }
});

// ── Exportar 606 a CSV ──────────────────────────────────────────────────────
router.get('/export/606', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { mes, anio } = req.query;
        const now = new Date();
        const mesFilt = mes ? parseInt(mes) : (now.getMonth() + 1);
        const anioFilt = anio ? parseInt(anio) : now.getFullYear();

        const egresos = db.prepare(`
            SELECT ncf_suplidor, tipo_gasto, fecha, descripcion, subtotal, itbis, descuento, monto
            FROM estado_resultado_items
            WHERE negocio_id = ? AND tipo = 'gasto' AND ncf_suplidor IS NOT NULL
              AND strftime('%m', fecha) = ? AND strftime('%Y', fecha) = ?
            ORDER BY fecha ASC
        `).all(negocioId, String(mesFilt).padStart(2, '0'), String(anioFilt));

        const headers = ['NCF_Documento','Tipo_Gasto','Fecha_Comprobante','Detalle','Monto_Sin_ITBIS','ITBIS','Descuento','Total'];
        const rows = egresos.map(e => [
            e.ncf_suplidor,
            { insumo: '01', fijo: '02', personal: '03' }[e.tipo_gasto] || '04',
            e.fecha, e.descripcion, e.subtotal, e.itbis, e.descuento, e.monto
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="606_${anioFilt}_${String(mesFilt).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export 606:', error);
        res.status(500).json({ error: 'Error al exportar 606' });
    }
});

// ── Exportar 607 a CSV ──────────────────────────────────────────────────────
router.get('/export/607', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { mes, anio } = req.query;
        const now = new Date();
        const mesFilt = mes ? parseInt(mes) : (now.getMonth() + 1);
        const anioFilt = anio ? parseInt(anio) : now.getFullYear();

        const ventas = db.prepare(`
            SELECT v.secuencia_ecf, v.fecha, v.subtotal, v.itbis, v.descuento, v.total,
                   v.tipo_ecf, c.documento, c.nombre
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ?
              AND strftime('%m', v.fecha) = ? AND strftime('%Y', v.fecha) = ?
              AND v.estado_dgii != 'anulada'
            ORDER BY v.fecha ASC
        `).all(negocioId, String(mesFilt).padStart(2, '0'), String(anioFilt));

        const headers = ['NCF','Fecha_Comprobante','RNC_Cedula','Nombre_Cliente','Monto_Sin_ITBIS','ITBIS','Descuento','Total','Tipo_Ingresos'];
        const rows = ventas.map(v => [
            v.secuencia_ecf, v.fecha, v.documento || '', v.nombre || 'CONSUMIDOR FINAL',
            v.subtotal, v.itbis, v.descuento, v.total,
            { '31': '01', '32': '02', '33': '03', '34': '04' }[v.tipo_ecf] || '02'
        ]);

        let csv = '\uFEFF' + headers.join(';') + '\n';
        rows.forEach(r => {
            csv += r.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(';') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="607_${anioFilt}_${String(mesFilt).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (error) {
        console.error('Error export 607:', error);
        res.status(500).json({ error: 'Error al exportar 607' });
    }
});

router.get('/servicios', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { desde, hasta } = req.query;
        const ahora = new Date();
        const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;

        // La caja siempre está abierta para nuevas ventas
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

        // La caja siempre está abierta - no filtrar por caja cerrada

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
            caja_cerrada: false // Siempre abierta
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

        const ultimosRegistrados = db.prepare(`
            SELECT c.id, c.nombre, c.telefono, c.fecha_registro,
                   COUNT(v.id) as total_compras
            FROM clientes c
            LEFT JOIN ventas v ON c.id = v.cliente_id AND v.negocio_id = ?
            WHERE c.negocio_id = ?
            GROUP BY c.id
            ORDER BY c.fecha_registro DESC
            LIMIT 10
        `).all(negocioId, negocioId);

        res.json({
            resumen,
            masFrecuentes,
            ultimosRegistrados
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
        const ahora = new Date();
        const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;

        // Ventas sin cuadre (turno actual)
        const resumen = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0) as efectivo,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0) as transferencia,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0) as tarjeta
            FROM ventas
            WHERE negocio_id = ? AND cuadre_id IS NULL
        `).get(req.session.negocioId);

        // Desglose por banco (transferencias)
        const porBancoTransferencia = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad
            FROM ventas
            WHERE negocio_id = ? AND cuadre_id IS NULL AND metodo_pago = 'transferencia'
            GROUP BY banco
        `).all(req.session.negocioId);

        // Desglose por banco (tarjetas)
        const porBancoTarjeta = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad
            FROM ventas
            WHERE negocio_id = ? AND cuadre_id IS NULL AND metodo_pago = 'tarjeta'
            GROUP BY banco
        `).all(req.session.negocioId);

        const resumenFueraCuadre = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad
            FROM ventas
            WHERE negocio_id = ? AND cuadre_id IS NULL AND fuera_cuadre = 1
        `).get(req.session.negocioId);

        const ventas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.banco, v.fecha, v.fuera_cuadre, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ? AND v.cuadre_id IS NULL
            ORDER BY v.fecha ASC
        `).all(req.session.negocioId);

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

        // Egresos del turno actual (sin cuadre)
        const egresosTurno = db.prepare(`
            SELECT COALESCE(SUM(monto), 0) as total_egresos,
                   COUNT(*) as cantidad,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN monto ELSE 0 END), 0) as efectivo,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN monto ELSE 0 END), 0) as transferencia,
                   COALESCE(SUM(itbis_pagado), 0) as itbis_pagado_total
            FROM estado_resultado_items
            WHERE negocio_id = ? AND tipo = 'gasto' AND cuadre_id IS NULL
        `).get(req.session.negocioId);

        // ITBIS cobrado en ventas del turno (suma real de campo itbis)
        const itbisCobrado = db.prepare(`
            SELECT COALESCE(SUM(itbis), 0) as itbis_cobrado
            FROM ventas
            WHERE negocio_id = ? AND cuadre_id IS NULL
        `).get(req.session.negocioId);

        const listaEgresosTurno = db.prepare(`
            SELECT id, categoria, descripcion, monto, metodo_pago, fecha, hora
            FROM estado_resultado_items
            WHERE negocio_id = ? AND tipo = 'gasto' AND cuadre_id IS NULL
            ORDER BY created_at DESC
        `).all(req.session.negocioId);

        // Efectivo neto = ventas efectivo - egresos efectivo
        const efectivoNeto = resumen.efectivo - (egresosTurno.efectivo || 0);

        // Verificar si hay ventas pendientes (sin cuadre)
        const hayVentasPendientes = resumen.cantidad > 0;
        
        // Verificar si hay un cierre del día de hoy
        const cierreHoy = db.prepare(`
            SELECT id FROM cajas_cerradas 
            WHERE negocio_id = ? AND fecha LIKE ?
            ORDER BY id DESC LIMIT 1
        `).get(req.session.negocioId, `${hoy}%`);
        
        // La caja está cerrada si no hay ventas pendientes Y hay un cierre hoy
        const cajaCerrada = !hayVentasPendientes && cierreHoy !== undefined;
        
        // Datos del negocio
        const negocio = db.prepare('SELECT nombre, direccion, telefono FROM negocios WHERE id = ?').get(req.session.negocioId);

        res.json({
            resumen,
            resumenFueraCuadre,
            porBancoTransferencia,
            porBancoTarjeta,
            ventas: ventasConDetalles,
            egresosTurno,
            listaEgresosTurno,
            efectivoNeto,
            itbisCobrado: itbisCobrado.itbis_cobrado,
            itbisPagado: egresosTurno.itbis_pagado_total,
            itbisNeto: (itbisCobrado.itbis_cobrado || 0) - (egresosTurno.itbis_pagado_total || 0),
            fecha: hoy,
            caja_cerrada: cajaCerrada,
            negocio: negocio || { nombre: 'Mi Negocio', direccion: '', telefono: '' }
        });
    } catch (error) {
        console.error('Error en GET /cuadre:', error);
        res.status(500).json({ error: 'Error al obtener cuadre' });
    }
});

router.post('/cuadre/cerrar', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const ahora = new Date();
        const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
        const inicioMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
        
        const tipo = req.body.tipo || 'dia';
        const fechaPersonalizada = req.body.fecha || null;
        
        let fechaDesde;
        let fechaCierre;
        
        if (tipo === 'mes' && fechaPersonalizada) {
            fechaDesde = fechaPersonalizada;
            fechaCierre = `${fechaPersonalizada} al ${hoy}`;
        } else if (tipo === 'mes') {
            fechaDesde = inicioMes;
            fechaCierre = `${inicioMes} al ${hoy}`;
        } else {
            fechaDesde = hoy;
            fechaCierre = hoy;
        }

        // Determinar filtro de ventas según tipo
        let whereVentas = 'cuadre_id IS NULL';
        let ventasParams = [req.session.negocioId];
        
        if (tipo === 'dia') {
            whereVentas += ' AND DATE(fecha) = ?';
            ventasParams.push(hoy);
        } else {
            whereVentas += ' AND DATE(fecha) >= ?';
            ventasParams.push(fechaDesde);
        }

        // CONTAR VENTAS SEGÚN TIPO
        const resumen = db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total,
                   COUNT(*) as cantidad,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0) as efectivo,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0) as transferencia,
                   COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0) as tarjeta
            FROM ventas
            WHERE negocio_id = ? AND ${whereVentas}
        `).get(req.session.negocioId, ...(tipo === 'dia' ? [hoy] : [fechaDesde]));

        if (resumen.cantidad === 0) {
            return res.status(400).json({ error: 'No hay ventas pendientes. La caja ya está cerrada o no hay ventas nuevas.' });
        }

        // CREAR NUEVO REGISTRO DE CIERRE
        const result = db.prepare(`
            INSERT INTO cajas_cerradas (negocio_id, fecha, total, cantidad_ventas, efectivo, transferencia, tarjeta, user_id, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            fechaCierre,
            resumen.total,
            resumen.cantidad,
            resumen.efectivo,
            resumen.transferencia,
            resumen.tarjeta,
            req.session.userId,
            (tipo === 'mes' ? '[CIERRE MENSUAL] ' : '') + (req.body.notas || '')
        );

        const cierreId = result.lastInsertRowid;

        // MARCAR VENTAS CON EL NUEVO CIERRE (según tipo)
        const updateParams = [cierreId, req.session.negocioId];
        let updateWhere = 'cuadre_id IS NULL';
        
        if (tipo === 'dia') {
            updateWhere += ' AND DATE(fecha) = ?';
            updateParams.push(hoy);
        } else {
            updateWhere += ' AND DATE(fecha) >= ?';
            updateParams.push(fechaDesde);
        }
        
        db.prepare(`UPDATE ventas SET cuadre_id = ? WHERE negocio_id = ? AND ${updateWhere}`).run(...updateParams);
        
        // Marcar egrosos del turno actual con el cuadre_id
        let updateEgresosWhere = 'cuadre_id IS NULL AND tipo = ?';
        const updateEgresosParams = [cierreId, req.session.negocioId, 'gasto'];
        
        if (tipo === 'dia') {
            updateEgresosWhere += ' AND DATE(fecha) = ?';
            updateEgresosParams.push(hoy);
        } else {
            updateEgresosWhere += ' AND DATE(fecha) >= ?';
            updateEgresosParams.push(fechaDesde);
        }
        
        db.prepare(`UPDATE estado_resultado_items SET cuadre_id = ? WHERE negocio_id = ? AND ${updateEgresosWhere}`).run(...updateEgresosParams);
        
        // Si es cierre del día, marcar la caja como cerrada
        if (tipo === 'dia') {
            try {
                db.prepare(`INSERT OR IGNORE INTO config (negocio_id, caja_cerrada) VALUES (?, 0)`).run(req.session.negocioId);
                db.prepare(`UPDATE config SET caja_cerrada = 1 WHERE negocio_id = ?`).run(req.session.negocioId);
            } catch (e) {
                console.error('Error actualizando config:', e);
            }
        }

        // Ventas del día con detalles
        const ventasDelDia = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.banco, v.fecha, c.nombre as cliente
            FROM ventas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.negocio_id = ? AND v.cuadre_id = ?
            ORDER BY v.fecha ASC
        `).all(req.session.negocioId, cierreId);

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

        // Desglose por banco (transferencias)
        const porBancoTrans = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, SUM(total) as total, COUNT(*) as cantidad
            FROM ventas WHERE negocio_id = ? AND cuadre_id = ? AND metodo_pago = 'transferencia'
            GROUP BY banco
        `).all(req.session.negocioId, cierreId);

        // Desglose por banco (tarjetas)
        const porBancoTarj = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, SUM(total) as total, COUNT(*) as cantidad
            FROM ventas WHERE negocio_id = ? AND cuadre_id = ? AND metodo_pago = 'tarjeta'
            GROUP BY banco
        `).all(req.session.negocioId, cierreId);

        // Egresos solo para cierre mensual (visualización)
        let egresos = null;
        let totalEntregar = null;
        
        if (tipo === 'mes') {
            try {
                egresos = db.prepare(`
                    SELECT 
                        COALESCE(SUM(CASE WHEN categoria = 'costo_ventas' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as costo_ventas,
                        COALESCE(SUM(CASE WHEN categoria = 'gastos_operativos' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as gastos_fijos,
                        COALESCE(SUM(CASE WHEN categoria = 'otros_gastos' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as otros_costos,
                        COALESCE(SUM(CASE WHEN subtipo = 'gasto' THEN monto ELSE 0 END), 0) as gastos_personales,
                        COALESCE(SUM(CASE WHEN subtipo = 'costo' OR subtipo IS NULL THEN monto ELSE 0 END), 0) as total_costos,
                        COALESCE(SUM(CASE WHEN subtipo = 'gasto' THEN monto ELSE 0 END), 0) as total_gastos
                    FROM estado_resultado_items
                    WHERE negocio_id = ? AND tipo = 'gasto' AND DATE(fecha) >= ?
                `).get(req.session.negocioId, inicioMes);
                
                totalEntregar = resumen.total - ((egresos.total_costos || 0) + (egresos.total_gastos || 0));
            } catch (egresosError) {
                console.error('Error obteniendo egresos:', egresosError);
                egresos = { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0, total_egresos: 0 };
                totalEntregar = resumen.total;
            }
        }

        // Obtener datos del negocio
        const negocio = db.prepare('SELECT nombre, direccion, telefono FROM negocios WHERE id = ?').get(req.session.negocioId);

        res.json({
            success: true,
            mensaje: 'Caja cerrada correctamente',
            cierreId,
            negocio: negocio || { nombre: 'Mi Negocio', direccion: '', telefono: '' },
            resumen,
            porBancoTransferencia: porBancoTrans,
            porBancoTarjeta: porBancoTarj,
            egresos,
            totalEntregar,
            tipo,
            ventas: ventasConDetalles
        });
    } catch (error) {
        console.error('Error en cierre de caja:', error);
        res.status(500).json({ error: 'Error al cerrar caja: ' + error.message });
    }
});

router.post('/cuadre/abrir', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        
        // Desmarcar las ventas del último cierre (hacerlas disponibles para un nuevo cuadre)
        const cierre = db.prepare(`
            SELECT id FROM cajas_cerradas 
            WHERE negocio_id = ?
            ORDER BY id DESC LIMIT 1
        `).get(req.session.negocioId);
        
        if (cierre) {
            db.prepare('UPDATE ventas SET cuadre_id = NULL WHERE cuadre_id = ?').run(cierre.id);
            // También desmarcar egresos del cuadre
            db.prepare('UPDATE estado_resultado_items SET cuadre_id = NULL WHERE cuadre_id = ?').run(cierre.id);
        }
        
        // Eliminar el cierre más reciente para limpiar el estado
        if (cierre) {
            db.prepare('DELETE FROM cajas_cerradas WHERE id = ?').run(cierre.id);
        }
        
        // Abrir la caja (habilitar ventas)
        try {
            db.prepare(`INSERT OR IGNORE INTO config (negocio_id, caja_cerrada) VALUES (?, 0)`).run(req.session.negocioId);
            db.prepare(`UPDATE config SET caja_cerrada = 0 WHERE negocio_id = ?`).run(req.session.negocioId);
        } catch (e) {
            console.error('Error abriendo caja:', e);
        }
        
        res.json({ success: true, mensaje: 'Caja abierta. Nuevo turno iniciado. Las ventas ahora están disponibles para un nuevo cierre.' });
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
            SELECT v.id, v.total, v.metodo_pago, v.banco, v.fecha, c.nombre as cliente
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

        // Desglose por banco
        const porBancoTrans = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, SUM(total) as total
            FROM ventas WHERE negocio_id = ? AND DATE(fecha) = ? AND metodo_pago = 'transferencia'
            GROUP BY banco
        `).all(req.session.negocioId, fecha);

        const porBancoTarj = db.prepare(`
            SELECT COALESCE(banco, 'Sin banco') as banco, SUM(total) as total
            FROM ventas WHERE negocio_id = ? AND DATE(fecha) = ? AND metodo_pago = 'tarjeta'
            GROUP BY banco
        `).all(req.session.negocioId, fecha);

        // Egresos solo para cierre mensual
        const esCierreMensual = cierre.notas && cierre.notas.includes('[CIERRE MENSUAL]');
        let egresos = null;
        let totalEntregar = null;
        
        if (esCierreMensual) {
            // Para cierre mensual, obtener egresos de todo el mes
            const inicioMes = fecha.substring(0, 7) + '-01';
            try {
                egresos = db.prepare(`
                    SELECT 
                        COALESCE(SUM(CASE WHEN categoria = 'costo_ventas' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as costo_ventas,
                        COALESCE(SUM(CASE WHEN categoria = 'gastos_operativos' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as gastos_fijos,
                        COALESCE(SUM(CASE WHEN categoria = 'otros_gastos' AND (subtipo = 'costo' OR subtipo IS NULL) THEN monto ELSE 0 END), 0) as otros_costos,
                        COALESCE(SUM(CASE WHEN subtipo = 'gasto' THEN monto ELSE 0 END), 0) as gastos_personales,
                        COALESCE(SUM(CASE WHEN subtipo = 'costo' OR subtipo IS NULL THEN monto ELSE 0 END), 0) as total_costos,
                        COALESCE(SUM(CASE WHEN subtipo = 'gasto' THEN monto ELSE 0 END), 0) as total_gastos
                    FROM estado_resultado_items
                    WHERE negocio_id = ? AND tipo = 'gasto' AND DATE(fecha) >= ?
                `).get(req.session.negocioId, inicioMes);
                
                totalEntregar = cierre.total - ((egresos.total_costos || 0) + (egresos.total_gastos || 0));
            } catch (egresosError) {
                console.error('Error obteniendo egresos:', egresosError);
                egresos = { costo_ventas: 0, gastos_fijos: 0, otros_costos: 0, gastos_personales: 0, total_costos: 0, total_gastos: 0 };
                totalEntregar = cierre.total;
            }
        }

        // Datos del negocio
        const negocio = db.prepare('SELECT nombre, direccion, telefono FROM negocios WHERE id = ?').get(req.session.negocioId);
        
        res.json({
            cierre,
            ventas: ventasConDetalles,
            porBancoTransferencia: porBancoTrans,
            porBancoTarjeta: porBancoTarj,
            egresos,
            totalEntregar,
            tipo: esCierreMensual ? 'mes' : 'dia',
            negocio: negocio || { nombre: 'Mi Negocio', direccion: '', telefono: '' }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener detalles' });
    }
});

// Endpoint para limpiar cuadres antiguos (más de 7 días) - DEBE IR ANTES DE /:id
router.delete('/cuadre/cleanup', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - 7);
        const fechaLimiteStr = `${fechaLimite.getFullYear()}-${String(fechaLimite.getMonth() + 1).padStart(2, '0')}-${String(fechaLimite.getDate()).padStart(2, '0')}`;

        // Primero desvincular las ventas de los cuadres antiguos
        db.prepare(`
            UPDATE ventas 
            SET cuadre_id = NULL 
            WHERE cuadre_id IN (
                SELECT id FROM cajas_cerradas 
                WHERE negocio_id = ? AND fecha < ?
            )
        `).run(req.session.negocioId, fechaLimiteStr);

        // Desvincular egresos de los cuadres antiguos
        db.prepare(`
            UPDATE estado_resultado_items 
            SET cuadre_id = NULL 
            WHERE cuadre_id IN (
                SELECT id FROM cajas_cerradas 
                WHERE negocio_id = ? AND fecha < ?
            )
        `).run(req.session.negocioId, fechaLimiteStr);

        // Ahora eliminar los cuadres
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
        console.error('Error cleanup:', error);
        res.status(500).json({ error: 'Error al limpiar cuadres: ' + error.message });
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

        // Desmarcar las ventas de este cuadre (vuelven a estado pendiente)
        db.prepare('UPDATE ventas SET cuadre_id = NULL WHERE cuadre_id = ?').run(req.params.id);
        // Desmarcar egresos de este cuadre
        db.prepare('UPDATE estado_resultado_items SET cuadre_id = NULL WHERE cuadre_id = ?').run(req.params.id);

        // Eliminar el registro de cierre
        db.prepare('DELETE FROM cajas_cerradas WHERE id = ?').run(req.params.id);

        res.json({ success: true, mensaje: 'Cuadre eliminado. Las ventas vuelven a estar pendientes.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar cuadre' });
    }
});

module.exports = router;
