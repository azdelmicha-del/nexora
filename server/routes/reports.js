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
            SELECT v.id, v.total, v.metodo_pago, v.banco, v.fecha, c.nombre as cliente
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
                   COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN monto ELSE 0 END), 0) as transferencia
            FROM estado_resultado_items
            WHERE negocio_id = ? AND tipo = 'gasto' AND cuadre_id IS NULL
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
