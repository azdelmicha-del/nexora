const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRDTimestamp } = require('../utils/timezone');
const { toTitleCase, capitalizeFirst } = require('../utils/validators');


const router = express.Router();

// router.use(requireTurnoAbierto); // Turno obligatorio para operar egresos/estado de resultado (deshabilitado temporalmente)

// Obtener items del estado de resultado por rango de fechas
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const { desde, hasta, turno } = req.query;

        const filter = { negocio_id: normalizeId(req.session.negocioId) };

        if (turno === 'actual') {
            filter.cuadre_id = null;
        }

        if (desde || hasta) {
            filter.fecha = {};
            if (desde) {
                filter.fecha.$gte = desde;
            }
            if (hasta) {
                filter.fecha.$lte = hasta;
            }
        }

        const items = await db.collection('estado_resultado_items')
            .find(filter)
            .sort({ fecha: -1, created_at: -1 })
            .toArray();

        // Obtener ventas automáticas del POS
        // venta_id = id real de la venta para cargar detalles desde /api/sales/:id
        const ventasFilter = { negocio_id: normalizeId(req.session.negocioId) };

        if (turno === 'actual') {
            ventasFilter.cuadre_id = null;
        }

        if (desde || hasta) {
            ventasFilter.fecha = {};
            if (desde) {
                ventasFilter.fecha.$gte = desde;
            }
            if (hasta) {
                ventasFilter.fecha.$lte = hasta + 'T23:59:59.999Z';
            }
        }

        const ventasPOS = await db.collection('ventas')
            .find(ventasFilter)
            .sort({ fecha: -1 })
            .toArray();

        const ventasPOSMapped = ventasPOS.map(v => ({
            id: v._id.toString(),
            venta_id: v._id.toString(),
            monto: v.total,
            subtotal: v.subtotal,
            itbis: v.itbis,
            descuento: v.descuento,
            fecha: v.fecha,
            metodo_pago: v.metodo_pago,
            secuencia_ecf: v.secuencia_ecf,
            categoria: 'venta_pos',
            tipo: 'ingreso',
            descripcion: `Venta #${v._id.toString()}`,
            subtipo: 'ingreso'
        }));

        const totalVentasPOS = ventasPOSMapped.reduce((sum, v) => sum + v.monto, 0);

        // Combinar items manuales + ventas POS
        const itemsMapped = items.map(item => ({
            ...item,
            id: item._id.toString()
        }));

        const todosLosItems = [...itemsMapped, ...ventasPOSMapped].sort((a, b) => {
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
        itemsMapped.forEach(item => {
            if (totales.hasOwnProperty(item.categoria)) {
                totales[item.categoria] += item.monto;
            }
        });

        // Sumar ventas del POS al total de ventas
        totales.ventas += totalVentasPOS;

        // Calcular resultados
        const ingresosTotales = totales.ventas;
        const totalCostos = totales.costo_ventas + totales.gastos_operativos + totales.otros_gastos;
        const totalGastos = itemsMapped.filter(i => i.tipo === 'gasto' && i.subtipo === 'gasto').reduce((s, i) => s + i.monto, 0);
        const utilidadBruta = ingresosTotales - totales.costo_ventas;
        const utilidadOperativa = utilidadBruta - totales.gastos_operativos;
        const resultadoNeto = utilidadOperativa + totales.otros_ingresos - totales.otros_gastos - totalGastos;

        res.json({
            items: todosLosItems,
            ventasPOS: {
                total: totalVentasPOS,
                cantidad: ventasPOSMapped.length
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
router.post('/', requireAuth, requireAdmin, async (req, res) => {
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

        const result = await db.collection('estado_resultado_items').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            tipo,
            subtipo: subtipoFinal,
            categoria,
            descripcion: toTitleCase(descripcion.trim()),
            subtotal: parseFloat(subtotal) || 0,
            itbis: parseFloat(itbis) || 0,
            descuento: parseFloat(descuento) || 0,
            monto: parseFloat(monto),
            metodo_pago: metodoPago,
            fecha,
            hora: horaActual,
            notas: notas ? notas.trim() : null,
            ncf_suplidor: ncf_suplidor ? ncf_suplidor.trim().toUpperCase() : null,
            itbis_pagado: itbisPagadoFinal,
            tipo_gasto: tipo_gasto || null
        });

        const item = await db.collection('estado_resultado_items').findOne({ _id: result.insertedId });

        res.json({
            ...item,
            id: item._id.toString()
        });
    } catch (error) {
        console.error('Error al agregar item:', error);
        res.status(500).json({ error: 'Error al agregar item' });
    }
});

// Actualizar item
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const {
            tipo, categoria, descripcion,
            subtotal, itbis, descuento, monto, fecha, notas, metodo_pago,
            // Campos fiscales para compensacion de ITBIS
            ncf_suplidor, itbis_pagado, tipo_gasto
        } = req.body;
        const itemId = normalizeId(req.params.id);

        const db = getDb();

        
        let objectId;
        try {
            objectId = itemId;
        } catch (e) {
            return res.status(400).json({ error: 'ID de item inválido' });
        }

        const item = await db.collection('estado_resultado_items').findOne({
            _id: objectId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!item) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }

        const updates = {};

        if (tipo) {
            updates.tipo = tipo;
        }
        if (categoria) {
            updates.categoria = categoria;
            if (categoria === 'gastos_personales') {
                updates.subtipo = 'gasto';
            } else {
                updates.subtipo = 'costo';
            }
        }
        if (descripcion) {
            updates.descripcion = toTitleCase(descripcion.trim());
        }
        if (subtotal !== undefined) {
            updates.subtotal = parseFloat(subtotal) || 0;
        }
        if (itbis !== undefined) {
            updates.itbis = parseFloat(itbis) || 0;
        }
        if (descuento !== undefined) {
            updates.descuento = parseFloat(descuento) || 0;
        }
        if (monto !== undefined) {
            updates.monto = parseFloat(monto);
        }
        if (metodo_pago) {
            updates.metodo_pago = metodo_pago;
        }
        if (fecha) {
            updates.fecha = fecha;
        }
        if (notas !== undefined) {
            updates.notas = notas ? notas.trim() : null;
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
                updates.ncf_suplidor = ncf_suplidor.trim().toUpperCase();
            } else {
                updates.ncf_suplidor = null;
            }
        }
        if (itbis_pagado !== undefined) {
            const itbisPagadoPUT = parseFloat(itbis_pagado) || 0;
            if (itbisPagadoPUT < 0) {
                return res.status(400).json({ error: 'itbis_pagado no puede ser negativo' });
            }
            updates.itbis_pagado = itbisPagadoPUT;
        }
        if (tipo_gasto !== undefined) {
            if (tipo_gasto !== null && tipo_gasto !== '') {
                const TIPOS_GASTO_VALIDOS = ['insumo', 'fijo', 'personal'];
                if (!TIPOS_GASTO_VALIDOS.includes(tipo_gasto)) {
                    return res.status(400).json({
                        error: 'tipo_gasto debe ser uno de: insumo, fijo, personal'
                    });
                }
                updates.tipo_gasto = tipo_gasto;
            } else {
                updates.tipo_gasto = null;
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('estado_resultado_items').updateOne(
            { _id: objectId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: updates }
        );

        const updated = await db.collection('estado_resultado_items').findOne({
            _id: objectId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        res.json({
            ...updated,
            id: updated._id.toString()
        });
    } catch (error) {
        console.error('Error al actualizar item:', error);
        res.status(500).json({ error: 'Error al actualizar item' });
    }
});

// Eliminar item
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const itemId = normalizeId(req.params.id);

        const { ObjectId } = require('mongodb');
        let objectId;
        try {
            objectId = itemId;
        } catch (e) {
            return res.status(400).json({ error: 'ID de item inválido' });
        }

        const item = await db.collection('estado_resultado_items').findOne({
            _id: objectId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!item) {
            return res.status(404).json({ error: 'Item no encontrado' });
        }

        await db.collection('estado_resultado_items').deleteOne({
            _id: objectId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        res.json({ success: true, message: 'Item eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar item:', error);
        res.status(500).json({ error: 'Error al eliminar item' });
    }
});

module.exports = router;
