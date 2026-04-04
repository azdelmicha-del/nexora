const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRDTimestamp } = require('../utils/timezone');
const { toTitleCase, capitalizeFirst } = require('../utils/validators');

const router = express.Router();

// Obtener items del estado de resultado por rango de fechas
router.get('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const { desde, hasta, turno } = req.query;
        
        let query = `
            SELECT * FROM estado_resultado_items 
            WHERE negocio_id = ?
        `;
        const params = [req.session.negocioId];
        
        if (turno === 'actual') {
            query += ' AND cuadre_id IS NULL';
        }
        
        if (desde) {
            query += ' AND fecha >= ?';
            params.push(desde);
        }
        if (hasta) {
            query += ' AND fecha <= ?';
            params.push(hasta);
        }
        
        query += ' ORDER BY fecha DESC, created_at DESC';
        
        const items = db.prepare(query).all(...params);
        
        // Obtener ventas automáticas del POS
        // venta_id = id real de la venta para cargar detalles desde /api/sales/:id
        let ventasQuery = `
            SELECT id, id as venta_id, total as monto, subtotal, itbis, descuento,
                   fecha, metodo_pago, secuencia_ecf,
                   'venta_pos' as categoria, 'ingreso' as tipo,
                   'Venta #' || id as descripcion, 'ingreso' as subtipo
            FROM ventas 
            WHERE negocio_id = ?
        `;
        const ventasParams = [req.session.negocioId];
        
        if (turno === 'actual') {
            ventasQuery += ' AND cuadre_id IS NULL';
        }
        
        if (desde) {
            ventasQuery += ' AND date(fecha) >= ?';
            ventasParams.push(desde);
        }
        if (hasta) {
            ventasQuery += ' AND date(fecha) <= ?';
            ventasParams.push(hasta);
        }
        
        ventasQuery += ' ORDER BY fecha DESC';
        
        const ventasPOS = db.prepare(ventasQuery).all(...ventasParams);
        const totalVentasPOS = ventasPOS.reduce((sum, v) => sum + v.monto, 0);
        
        // Combinar items manuales + ventas POS
        const todosLosItems = [...items, ...ventasPOS].sort((a, b) => {
            if (b.fecha > a.fecha) return 1;
            if (b.fecha < a.fecha) return -1;
            return 0;
        });
        
        // Calcular totales por categoría
        const totales = {
            ventas: 0,
            costo_ventas: 0,
            gastos_operativos: 0,
            otros_ingresos: 0,
            otros_gastos: 0,
            gastos_personales: 0
        };
        
        // Sumar ventas manuales
        items.forEach(item => {
            if (totales.hasOwnProperty(item.categoria)) {
                totales[item.categoria] += item.monto;
            }
        });
        
        // Sumar ventas del POS al total de ventas
        totales.ventas += totalVentasPOS;
        
        // Calcular resultados
        const ingresosTotales = totales.ventas;
        const totalCostos = totales.costo_ventas + totales.gastos_operativos + totales.otros_gastos;
        const totalGastos = items.filter(i => i.tipo === 'gasto' && i.subtipo === 'gasto').reduce((s, i) => s + i.monto, 0);
        const utilidadBruta = ingresosTotales - totales.costo_ventas;
        const utilidadOperativa = utilidadBruta - totales.gastos_operativos;
        const resultadoNeto = utilidadOperativa + totales.otros_ingresos - totales.otros_gastos - totalGastos;
        
        res.json({
            items: todosLosItems,
            ventasPOS: {
                total: totalVentasPOS,
                cantidad: ventasPOS.length
            },
            totales,
            resumen: {
                ingresos_totales: ingresosTotales,
                costo_ventas: totales.costo_ventas,
                utilidad_bruta: utilidadBruta,
                gastos_operativos: totales.gastos_operativos,
                utilidad_operativa: utilidadOperativa,
                otros_ingresos: totales.otros_ingresos,
                otros_gastos: totales.otros_gastos,
                total_costos: totalCostos,
                total_gastos: totalGastos,
                resultado_neto: resultadoNeto
            }
        });
    } catch (error) {
        console.error('Error al obtener estado de resultado:', error);
        res.status(500).json({ error: 'Error al obtener estado de resultado' });
    }
});

// Agregar item al estado de resultado
router.post('/', requireAuth, requireAdmin, (req, res) => {
    try {
        const {
            tipo, subtipo, categoria, descripcion,
            subtotal, itbis, descuento, monto, fecha, notas, metodo_pago,
            // Campos fiscales para compensacion de ITBIS
            ncf_suplidor, itbis_pagado, tipo_gasto
        } = req.body;
        
        if (!tipo || !categoria || !descripcion || !monto || !fecha) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }
        
        if (!['ingreso', 'gasto'].includes(tipo)) {
            return res.status(400).json({ error: 'Tipo debe ser ingreso o gasto' });
        }
        
        const categoriasValidas = ['ventas', 'costo_ventas', 'gastos_operativos', 'otros_ingresos', 'otros_gastos', 'gastos_personales'];
        if (!categoriasValidas.includes(categoria)) {
            return res.status(400).json({ error: 'Categoría no válida' });
        }
        
        if (monto <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }

        // Validar NCF suplidor si se provee.
        // Formato RD: NCF fisico (B + 2 digitos tipo + 8 digitos seq)
        //             e-CF      (E + 2 digitos tipo + 10 digitos seq)
        if (ncf_suplidor) {
            const NCF_REGEX = /^[BE]\d{2}\d{8,10}$/;
            if (!NCF_REGEX.test(ncf_suplidor.trim())) {
                return res.status(400).json({
                    error: 'Formato de NCF suplidor inválido. Ejemplos válidos: B0100000001 (físico), E310000000001 (e-CF)'
                });
            }
        }

        // Validar tipo_gasto si se provee
        const TIPOS_GASTO_VALIDOS = ['insumo', 'fijo', 'personal'];
        if (tipo_gasto && !TIPOS_GASTO_VALIDOS.includes(tipo_gasto)) {
            return res.status(400).json({
                error: 'tipo_gasto debe ser uno de: insumo, fijo, personal'
            });
        }

        // itbis_pagado debe ser un numero no negativo si se provee
        const itbisPagadoFinal = parseFloat(itbis_pagado) || 0;
        if (itbisPagadoFinal < 0) {
            return res.status(400).json({ error: 'itbis_pagado no puede ser negativo' });
        }
        
        // Determinar subtipo automáticamente según la categoría
        let subtipoFinal = subtipo;
        if (tipo === 'gasto') {
            if (categoria === 'gastos_personales') {
                subtipoFinal = 'gasto';
            } else {
                subtipoFinal = 'costo';
            }
        }
        
        // Obtener hora actual
        const horaActual = getRDTimestamp().split(' ')[1];
        
        const metodoPago = metodo_pago || 'efectivo';
        
        const db = getDb();
        
        const result = db.prepare(`
            INSERT INTO estado_resultado_items (
                negocio_id, tipo, subtipo, categoria, descripcion,
                subtotal, itbis, descuento, monto, metodo_pago,
                fecha, hora, notas,
                ncf_suplidor, itbis_pagado, tipo_gasto
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            tipo,
            subtipoFinal,
            categoria,
            toTitleCase(descripcion.trim()),
            parseFloat(subtotal) || 0,
            parseFloat(itbis) || 0,
            parseFloat(descuento) || 0,
            parseFloat(monto),
            metodoPago,
            fecha,
            horaActual,
            notas ? notas.trim() : null,
            ncf_suplidor ? ncf_suplidor.trim().toUpperCase() : null,
            itbisPagadoFinal,
            tipo_gasto || null
        );
        
        const item = db.prepare('SELECT * FROM estado_resultado_items WHERE id = ?').get(result.lastInsertRowid);
        
        res.json(item);
    } catch (error) {
        console.error('Error al agregar item:', error);
        res.status(500).json({ error: 'Error al agregar item' });
    }
});

// Actualizar item
router.put('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const {
            tipo, categoria, descripcion,
            subtotal, itbis, descuento, monto, fecha, notas, metodo_pago,
            // Campos fiscales para compensacion de ITBIS
            ncf_suplidor, itbis_pagado, tipo_gasto
        } = req.body;
        const itemId = req.params.id;
        
        const db = getDb();
        
        const item = db.prepare('SELECT id FROM estado_resultado_items WHERE id = ? AND negocio_id = ?')
            .get(itemId, req.session.negocioId);
        
        if (!item) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }
        
        const updates = [];
        const values = [];
        
        if (tipo) {
            updates.push('tipo = ?');
            values.push(tipo);
        }
        if (categoria) {
            updates.push('categoria = ?');
            values.push(categoria);
            if (categoria === 'gastos_personales') {
                updates.push('subtipo = ?');
                values.push('gasto');
            } else {
                updates.push('subtipo = ?');
                values.push('costo');
            }
        }
        if (descripcion) {
            updates.push('descripcion = ?');
            values.push(toTitleCase(descripcion.trim()));
        }
        if (subtotal !== undefined) {
            updates.push('subtotal = ?');
            values.push(parseFloat(subtotal) || 0);
        }
        if (itbis !== undefined) {
            updates.push('itbis = ?');
            values.push(parseFloat(itbis) || 0);
        }
        if (descuento !== undefined) {
            updates.push('descuento = ?');
            values.push(parseFloat(descuento) || 0);
        }
        if (monto !== undefined) {
            updates.push('monto = ?');
            values.push(parseFloat(monto));
        }
        if (metodo_pago) {
            updates.push('metodo_pago = ?');
            values.push(metodo_pago);
        }
        if (fecha) {
            updates.push('fecha = ?');
            values.push(fecha);
        }
        if (notas !== undefined) {
            updates.push('notas = ?');
            values.push(notas ? notas.trim() : null);
        }

        // Campos fiscales — opcionales en cada PUT
        if (ncf_suplidor !== undefined) {
            if (ncf_suplidor !== null && ncf_suplidor !== '') {
                const NCF_REGEX = /^[BE]\d{2}\d{8,10}$/;
                if (!NCF_REGEX.test(ncf_suplidor.trim())) {
                    return res.status(400).json({
                        error: 'Formato de NCF suplidor inválido. Ejemplos válidos: B0100000001 (físico), E310000000001 (e-CF)'
                    });
                }
                updates.push('ncf_suplidor = ?');
                values.push(ncf_suplidor.trim().toUpperCase());
            } else {
                updates.push('ncf_suplidor = ?');
                values.push(null);
            }
        }
        if (itbis_pagado !== undefined) {
            const itbisPagadoPUT = parseFloat(itbis_pagado) || 0;
            if (itbisPagadoPUT < 0) {
                return res.status(400).json({ error: 'itbis_pagado no puede ser negativo' });
            }
            updates.push('itbis_pagado = ?');
            values.push(itbisPagadoPUT);
        }
        if (tipo_gasto !== undefined) {
            if (tipo_gasto !== null && tipo_gasto !== '') {
                const TIPOS_GASTO_VALIDOS = ['insumo', 'fijo', 'personal'];
                if (!TIPOS_GASTO_VALIDOS.includes(tipo_gasto)) {
                    return res.status(400).json({
                        error: 'tipo_gasto debe ser uno de: insumo, fijo, personal'
                    });
                }
                updates.push('tipo_gasto = ?');
                values.push(tipo_gasto);
            } else {
                updates.push('tipo_gasto = ?');
                values.push(null);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }
        
        values.push(itemId);
        db.prepare(`UPDATE estado_resultado_items SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        
        const updated = db.prepare('SELECT * FROM estado_resultado_items WHERE id = ?').get(itemId);
        
        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar item:', error);
        res.status(500).json({ error: 'Error al actualizar item' });
    }
});

// Eliminar item
router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const itemId = req.params.id;
        
        const item = db.prepare('SELECT id FROM estado_resultado_items WHERE id = ? AND negocio_id = ?')
            .get(itemId, req.session.negocioId);
        
        if (!item) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }
        
        db.prepare('DELETE FROM estado_resultado_items WHERE id = ?').run(itemId);
        
        res.json({ success: true, message: 'Item eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar item:', error);
        res.status(500).json({ error: 'Error al eliminar item' });
    }
});

module.exports = router;
