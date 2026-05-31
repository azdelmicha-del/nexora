const express = require('express');
const { getDb, getNextNCF, toPlainId, toPlainArray, normalizeId } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { round2, validateDocumento, generarCodigoSeguridad, calcularTotalesVenta } = require('../utils/dgii');
const { getRDTimestamp, getRDDateString, getRDDate } = require('../utils/timezone');
const QRCode = require('qrcode');

function formatCurrencyRD(amount) {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(amount || 0);
}


const router = express.Router();

// router.use(requireTurnoAbierto); // Turno obligatorio para operar ventas (deshabilitado temporalmente)

router.get('/config', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.session.negocioId) });
        const config = await db.collection('config').findOne({ negocio_id: normalizeId(req.session.negocioId) });

        res.json({
            metodo_efectivo: negocio?.metodo_efectivo !== 0,
            metodo_transferencia: negocio?.metodo_transferencia !== 0,
            metodo_tarjeta: negocio?.metodo_tarjeta !== 0,
            activar_descuentos: negocio?.activar_descuentos !== 0,
            caja_cerrada: Boolean(config && Number(config.caja_cerrada) === 1)
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        const {
            cliente_id,
            items,
            metodo_pago,
            descuento,
            banco,
            tipo_ecf,
            origen_modulo,
            origen_id,
            cliente_documento,
            cliente_tipo_documento,
            cliente_nombre
        } = req.body;

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

        if (!['31', '32'].includes(String(tipoECF))) {
            return res.status(400).json({ error: 'Tipo de comprobante inválido. Use E31 o E32.' });
        }

        const itemsNormalizados = items.map((item) => ({
            servicio_id: item?.servicio_id || null,
            producto_id: item?.producto_id || null,
            menu_item_id: item?.menu_item_id || null,
            cantidad: Number.parseInt(item?.cantidad, 10)
        }));

        const itemsValidos = itemsNormalizados.every((item) => {
            const tieneReferencia = Boolean(item.servicio_id || item.producto_id || item.menu_item_id);
            return Number.isInteger(item.cantidad) && item.cantidad > 0 && tieneReferencia;
        });
        if (!itemsValidos) {
            return res.status(400).json({ error: 'Items de venta inválidos' });
        }

        if (!['pos', 'cita', 'pedido'].includes(origenModulo)) {
            return res.status(400).json({ error: 'Origen de venta invalido' });
        }
        if (origen_id != null && (!Number.isInteger(origenId) || origenId <= 0)) {
            return res.status(400).json({ error: 'origen_id invalido' });
        }

        const db = getDb();

        // ── VERIFICAR CAJA CERRADA ANTES DE CUALQUIER COSA ──────────────────────────
        const estadoCaja = await db.collection('config').findOne({ negocio_id: normalizeId(req.session.negocioId) });
        const cajaCerrada = Boolean(estadoCaja && Number(estadoCaja.caja_cerrada) === 1);
        if (cajaCerrada) {
            return res.status(403).json({ error: 'Caja cerrada. Abra la caja en Reportes antes de facturar.' });
        }

        if (origenModulo === 'pedido' && origenId) {
            const pedido = await db.collection('pedidos').findOne({ _id: origenId, negocio_id: normalizeId(req.session.negocioId) });
            if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado para facturar' });
            if (!['confirmado', 'entregado'].includes(pedido.estado)) {
                return res.status(400).json({ error: 'El pedido debe estar confirmado o entregado para facturar' });
            }
            if (pedido.venta_id) return res.status(400).json({ error: 'Este pedido ya esta facturado' });
        }

        if (origenModulo === 'cita' && origenId) {
            const cita = await db.collection('citas').findOne({ _id: origenId, negocio_id: normalizeId(req.session.negocioId) });
            if (!cita) return res.status(404).json({ error: 'Cita no encontrada para facturar' });
            if (cita.estado === 'cancelada') return res.status(400).json({ error: 'No se puede facturar una cita cancelada' });
        }

        // Validar cliente y RNC si es Crédito Fiscal
        let clienteDoc = null;
        let clienteIdVenta = cliente_id ? Number.parseInt(cliente_id, 10) : null;
        if (clienteIdVenta) {
            const cliente = await db.collection('clientes').findOne({ _id: clienteIdVenta, negocio_id: normalizeId(req.session.negocioId) });
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
            const documentoFiscal = String(cliente_documento || '').replace(/[^0-9]/g, '');
            const validacion = validateDocumento(documentoFiscal);
            if (!validacion.valid) {
                return res.status(400).json({ error: 'Crédito Fiscal requiere RNC (9 dígitos) o Cédula (11 dígitos) válidos' });
            }

            const tipoDoc = (cliente_tipo_documento || (documentoFiscal.length === 9 ? 'rnc' : 'cedula')).toLowerCase();
            const nombreFiscal = String(cliente_nombre || 'Consumidor Final').trim() || 'Consumidor Final';

            const existente = await db.collection('clientes').findOne(
                { negocio_id: normalizeId(req.session.negocioId), documento: documentoFiscal }
            );

            if (existente) {
                clienteIdVenta = existente._id;
                clienteDoc = existente;
            } else {
                const insertCliente = await db.collection('clientes').insertOne({
                    negocio_id: normalizeId(req.session.negocioId),
                    nombre: nombreFiscal,
                    telefono: null,
                    email: null,
                    documento: documentoFiscal,
                    tipo_documento: tipoDoc,
                    estado: 'activo',
                    fecha_registro: getRDTimestamp()
                });

                clienteIdVenta = insertCliente.insertedId;
                clienteDoc = {
                    id: clienteIdVenta,
                    nombre: nombreFiscal,
                    documento: documentoFiscal,
                    tipo_documento: tipoDoc
                };
            }
        }

        const fechaLocal = getRDTimestamp();

        // ── Calcular totales con ITBIS individual por servicio ─────────────────
        // calcularTotalesVenta lee la itbis_tasa de cada servicio desde la DB,
        // valida que existan y distribuye el descuento proporcionalmente por línea.
        let totales;
        try {
            totales = calcularTotalesVenta(itemsNormalizados, db, normalizeId(req.session.negocioId), descuento || 0);
        } catch (calcError) {
            return res.status(400).json({ error: calcError.message });
        }

        if (descuento && (descuento < 0 || descuento > totales.subtotal)) {
            return res.status(400).json({ error: 'El descuento debe estar entre 0 y el total' });
        }

        const subtotalVenta = totales.subtotal;
        const descuentoMonto = totales.descuento;
        const itbisVenta = totales.total_itbis;
        const totalFinal = totales.total_general;

        // Generar secuencia NCF y código de seguridad
        const secuenciaECF = await getNextNCF(normalizeId(req.session.negocioId), tipoECF);
        const codigoSeguridad = generarCodigoSeguridad();

        // ── TRANSACCIÓN ATÓMICA: venta completa o rollback completo ─────────────
        const session = await db.startSession();
        let ventaId;
        try {
            await session.withTransaction(async () => {
                // Insertar venta principal
                const ventaResult = await db.collection('ventas').insertOne({
                    negocio_id: normalizeId(req.session.negocioId),
                    cliente_id: clienteIdVenta || null,
                    user_id: req.session.userId,
                    total: totalFinal,
                    subtotal: subtotalVenta,
                    itbis: itbisVenta,
                    descuento: round2(descuento || 0),
                    metodo_pago: metodo_pago,
                    banco: banco || null,
                    fuera_cuadre: 0,
                    tipo_ecf: tipoECF,
                    secuencia_ecf: secuenciaECF,
                    codigo_seguridad: codigoSeguridad,
                    estado_dgii: 'pendiente',
                    fecha: fechaLocal,
                    origen_modulo: origenModulo,
                    origen_id: origenId
                }, { session });

                ventaId = ventaResult.insertedId;

                // Insertar detalles y descontar stock
                for (const linea of totales.lineas) {
                    await db.collection('venta_detalles').insertOne({
                        venta_id: ventaId,
                        servicio_id: linea.servicio_id || null,
                        producto_id: linea.producto_id || null,
                        menu_item_id: linea.menu_item_id || null,
                        tipo_item: linea.tipo_item || 'servicio',
                        cantidad: linea.cantidad,
                        precio: linea.precio,
                        subtotal: linea.subtotal,
                        itbis_monto: linea.itbis_monto
                    }, { session });

                    // Descontar stock si es producto
                    if (linea.tipo_item === 'producto' && linea.producto_id) {
                        await db.collection('productos').updateOne(
                            { _id: linea.producto_id, negocio_id: normalizeId(req.session.negocioId) },
                            { $inc: { stock: -linea.cantidad } },
                            { session }
                        );
                        await db.collection('movimientos_inventario').insertOne({
                            negocio_id: normalizeId(req.session.negocioId),
                            producto_id: linea.producto_id,
                            tipo: 'venta',
                            cantidad: linea.cantidad,
                            costo_unitario: 0,
                            referencia: 'Venta #' + ventaId,
                            user_id: req.session.userId
                        }, { session });
                    }
                }

                // Notificación
                await db.collection('notificaciones').insertOne({
                    negocio_id: normalizeId(req.session.negocioId),
                    tipo: 'venta',
                    mensaje: 'Nueva venta registrada',
                    referencia_id: ventaId
                }, { session });

                // Actualizar origen
                if (origenModulo === 'pedido' && origenId) {
                    await db.collection('pedidos').updateOne(
                        { _id: origenId, negocio_id: normalizeId(req.session.negocioId) },
                        {
                            $set: {
                                venta_id: ventaId,
                                estado: 'entregado',
                                fecha_entregado: fechaLocal
                            }
                        },
                        { session }
                    );
                }
                if (origenModulo === 'cita' && origenId) {
                    await db.collection('citas').updateOne(
                        { _id: origenId, negocio_id: normalizeId(req.session.negocioId) },
                        { $set: { estado: 'finalizada' } },
                        { session }
                    );
                }

                // Lealtad: 1 punto por cada RD$100 gastado
                if (clienteIdVenta && totalFinal > 0) {
                    const puntosGanados = Math.floor(totalFinal / 100);
                    if (puntosGanados > 0) {
                        const plExistente = await db.collection('puntos_lealtad').findOne(
                            { negocio_id: normalizeId(req.session.negocioId), cliente_id: clienteIdVenta },
                            { session }
                        );
                        if (plExistente) {
                            const nuevosPuntos = plExistente.puntos + puntosGanados;
                            const nivel = nuevosPuntos >= 5000 ? 'platino' : nuevosPuntos >= 2000 ? 'oro' : nuevosPuntos >= 500 ? 'plata' : 'bronce';
                            await db.collection('puntos_lealtad').updateOne(
                                { _id: plExistente._id },
                                { $set: { puntos: nuevosPuntos, nivel: nivel, ultima_actividad: getRDDateString() } },
                                { session }
                            );
                        } else {
                            const nivel = puntosGanados >= 5000 ? 'platino' : puntosGanados >= 2000 ? 'oro' : puntosGanados >= 500 ? 'plata' : 'bronce';
                            await db.collection('puntos_lealtad').insertOne({
                                negocio_id: normalizeId(req.session.negocioId),
                                cliente_id: clienteIdVenta,
                                puntos: puntosGanados,
                                nivel: nivel,
                                ultima_actividad: getRDDateString()
                            }, { session });
                        }
                        await db.collection('historial_puntos').insertOne({
                            negocio_id: normalizeId(req.session.negocioId),
                            cliente_id: clienteIdVenta,
                            puntos: puntosGanados,
                            tipo: 'ganado',
                            referencia: 'Venta #' + ventaId
                        }, { session });
                    }
                }

                // Auditoría (sin rollback si falla)
                try {
                    await db.collection('log_auditoria').insertOne({
                        negocio_id: normalizeId(req.session.negocioId),
                        user_id: req.session.userId,
                        accion: 'POST',
                        tabla: 'ventas',
                        registro_id: ventaId,
                        detalle: 'Venta #' + ventaId + ' - ' + formatCurrencyRD(totalFinal),
                        ip: req.ip,
                        user_agent: req.headers['user-agent']
                    }, { session });
                } catch (e) { /* no bloquear */ }
            });
        } finally {
            await session.endSession();
        }

        const venta = await db.collection('ventas').aggregate([
            { $match: { _id: ventaId } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    subtotal: 1,
                    itbis: 1,
                    descuento: 1,
                    metodo_pago: 1,
                    banco: 1,
                    fecha: 1,
                    fuera_cuadre: 1,
                    tipo_ecf: 1,
                    secuencia_ecf: 1,
                    codigo_seguridad: 1,
                    estado_dgii: 1,
                    cliente: '$clienteData.nombre',
                    cliente_documento: '$clienteData.documento'
                }
            }
        ]).toArray();

        res.json(venta[0] || {});
    } catch (error) {
        console.error('Error al crear venta:', error);
        res.status(500).json({ error: 'Error al procesar la venta: ' + (error.message || error) });
    }
});

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const { fecha, cliente, metodo } = req.query;

        const match = { negocio_id: normalizeId(req.session.negocioId) };

        if (fecha) {
            const startOfDay = new Date(fecha);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(fecha);
            endOfDay.setHours(23, 59, 59, 999);
            match.fecha = { $gte: startOfDay.toISOString(), $lte: endOfDay.toISOString() };
        }

        if (cliente) {
            const clientes = await db.collection('clientes').find(
                { nombre: { $regex: cliente, $options: 'i' } },
                { projection: { _id: 1 } }
            ).toArray();
            const clienteIds = clientes.map(c => c._id);
            match.cliente_id = { $in: clienteIds.length > 0 ? clienteIds : [null] };
        }

        if (metodo) {
            match.metodo_pago = metodo;
        }

        const ventas = await db.collection('ventas').aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            { $unwind: { path: '$userData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    descuento: 1,
                    metodo_pago: 1,
                    banco: 1,
                    fecha: 1,
                    cliente: '$clienteData.nombre',
                    usuario: '$userData.nombre'
                }
            },
            { $sort: { fecha: -1 } },
            { $limit: 100 }
        ]).toArray();

        res.json(toPlainArray(ventas));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener ventas' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();

        const ventaAgg = await db.collection('ventas').aggregate([
            { $match: { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'userData'
                }
            },
            { $unwind: { path: '$userData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    subtotal: 1,
                    itbis: 1,
                    descuento: 1,
                    metodo_pago: 1,
                    banco: 1,
                    fecha: 1,
                    tipo_ecf: 1,
                    secuencia_ecf: 1,
                    estado_dgii: 1,
                    cliente_id: '$clienteData._id',
                    cliente: '$clienteData.nombre',
                    cliente_documento: '$clienteData.documento',
                    usuario: '$userData.nombre'
                }
            }
        ]).toArray();

        const venta = ventaAgg[0];
        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const detallesAgg = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: venta.id } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioData'
                }
            },
            {
                $lookup: {
                    from: 'productos',
                    localField: 'producto_id',
                    foreignField: '_id',
                    as: 'productoData'
                }
            },
            {
                $lookup: {
                    from: 'menu_items',
                    localField: 'menu_item_id',
                    foreignField: '_id',
                    as: 'menuData'
                }
            },
            { $unwind: { path: '$servicioData', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$productoData', preserveNullAndEmptyArrays: true } },
            { $unwind: { path: '$menuData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    cantidad: 1,
                    precio: 1,
                    subtotal: 1,
                    itbis_monto: 1,
                    tipo_item: 1,
                    servicio: {
                        $cond: {
                            if: '$servicioData.nombre',
                            then: '$servicioData.nombre',
                            else: {
                                $cond: {
                                    if: '$productoData.nombre',
                                    then: '$productoData.nombre',
                                    else: { $ifNull: ['$menuData.nombre', null] }
                                }
                            }
                        }
                    },
                    itbis_tasa: {
                        $cond: {
                            if: '$servicioData.itbis_tasa',
                            then: '$servicioData.itbis_tasa',
                            else: {
                                $cond: {
                                    if: '$productoData.itbis_tasa',
                                    then: '$productoData.itbis_tasa',
                                    else: { $ifNull: ['$menuData.itbis_tasa', 18] }
                                }
                            }
                        }
                    }
                }
            }
        ]).toArray();

        const detalles = toPlainArray(detallesAgg);

        res.json({ ...toPlainId(venta), detalles });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener venta' });
    }
});

// Generar y descargar XML e-CF
router.get('/:id/xml', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const path = require('path');
        const fs = require('fs');
        const { generarXMLVenta } = require('../utils/xml-generator');

        const ventaAgg = await db.collection('ventas').aggregate([
            { $match: { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    subtotal: 1,
                    itbis: 1,
                    descuento: 1,
                    metodo_pago: 1,
                    banco: 1,
                    fecha: 1,
                    tipo_ecf: 1,
                    secuencia_ecf: 1,
                    codigo_seguridad: 1,
                    estado_dgii: 1,
                    xml_generado: 1,
                    cliente: '$clienteData.nombre',
                    cliente_documento: '$clienteData.documento'
                }
            }
        ]).toArray();

        const venta = ventaAgg[0];
        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.session.negocioId) });
        const detalles = await db.collection('venta_detalles').aggregate([
            { $match: { venta_id: venta.id } },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicioData'
                }
            },
            { $unwind: { path: '$servicioData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    cantidad: 1,
                    precio: 1,
                    subtotal: 1,
                    servicio: '$servicioData.nombre'
                }
            }
        ]).toArray();

        const cliente = venta.cliente_documento ? { nombre: venta.cliente, documento: venta.cliente_documento } : null;
        const xml = generarXMLVenta(venta, negocio, cliente, detalles);

        // Guardar XML en la DB
        await db.collection('ventas').updateOne(
            { _id: venta.id, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { xml_generado: xml } }
        );

        // Guardar copia en /facturas_electronicas/{negocio_id}/
        const dirPath = path.join(__dirname, '..', 'facturas_electronicas', String(normalizeId(req.session.negocioId)));
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        const fileName = `${venta.secuencia_ecf || `venta-${venta.id}`}.xml`;
        fs.writeFileSync(path.join(dirPath, fileName), xml, 'utf8');

        // Cambiar estado a 'firmado'
        await db.collection('ventas').updateOne(
            { _id: venta.id, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { estado_dgii: 'firmado' } }
        );

        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(xml);
    } catch (error) {
        console.error('Error generando XML:', error);
        res.status(500).json({ error: 'Error al generar XML: ' + error.message });
    }
});

// Datos para QR fiscal
router.get('/:id/qr', requireAuth, async (req, res) => {
    try {
        const db = getDb();

        const ventaAgg = await db.collection('ventas').aggregate([
            { $match: { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) } },
            {
                $lookup: {
                    from: 'negocios',
                    localField: 'negocio_id',
                    foreignField: '_id',
                    as: 'negocioData'
                }
            },
            { $unwind: { path: '$negocioData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    secuencia_ecf: 1,
                    fecha: 1,
                    tipo_ecf: 1,
                    codigo_seguridad: 1,
                    rnc_negocio: '$negocioData.rnc',
                    nombre_negocio: '$negocioData.nombre'
                }
            }
        ]).toArray();

        const venta = ventaAgg[0];
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

router.get('/resumen/dia', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const hoy = getRDDateString();

        const startOfDay = new Date(hoy);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(hoy);
        endOfDay.setHours(23, 59, 59, 999);

        const resumen = await db.collection('ventas').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    fecha: { $gte: startOfDay.toISOString(), $lte: endOfDay.toISOString() }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: { $ifNull: ['$total', 0] } },
                    cantidad: { $sum: 1 },
                    efectivo: {
                        $sum: {
                            $cond: [{ $eq: ['$metodo_pago', 'efectivo'] }, { $ifNull: ['$total', 0] }, 0]
                        }
                    },
                    transferencia: {
                        $sum: {
                            $cond: [{ $eq: ['$metodo_pago', 'transferencia'] }, { $ifNull: ['$total', 0] }, 0]
                        }
                    },
                    tarjeta: {
                        $sum: {
                            $cond: [{ $eq: ['$metodo_pago', 'tarjeta'] }, { $ifNull: ['$total', 0] }, 0]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    total: 1,
                    cantidad: 1,
                    efectivo: 1,
                    transferencia: 1,
                    tarjeta: 1
                }
            }
        ]).toArray();

        res.json(resumen[0] || { total: 0, cantidad: 0, efectivo: 0, transferencia: 0, tarjeta: 0 });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error' });
    }
});

// ── Nota de Credito (34) y Nota de Debito (33) ─────────────────────────────
// Permite anular o corregir facturas emitidas, requisito DGII
router.post('/nota-credito', requireAuth, async (req, res) => {
    try {
        const { venta_id, motivo, monto, tipo_nota = '34' } = req.body;

        if (!venta_id || !motivo || !monto) {
            return res.status(400).json({ error: 'venta_id, motivo y monto son requeridos' });
        }

        if (!['33', '34'].includes(tipo_nota)) {
            return res.status(400).json({ error: 'tipo_nota debe ser 33 (Debito) o 34 (Credito)' });
        }

        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

        // Verificar que la venta original existe y pertenece al negocio
        const ventaAgg = await db.collection('ventas').aggregate([
            { $match: { _id: venta_id, negocio_id: negocioId } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    total: 1,
                    subtotal: 1,
                    itbis: 1,
                    descuento: 1,
                    tipo_ecf: 1,
                    secuencia_ecf: 1,
                    cliente_id: 1,
                    fecha: 1,
                    cliente_nombre: '$clienteData.nombre',
                    cliente_documento: '$clienteData.documento',
                    cliente_tipo_doc: '$clienteData.tipo_documento'
                }
            }
        ]).toArray();

        const ventaOriginal = ventaAgg[0];
        if (!ventaOriginal) {
            return res.status(404).json({ error: 'Venta original no encontrada' });
        }

        // Generar NCF para la nota (33 o 34)
        const secuencia = await getNextNCF(negocioId, tipo_nota);
        const codigoSeg = generarCodigoSeguridad();
        const montoAbs = Math.abs(parseFloat(monto));

        // Crear registro en tabla notas_credito
        const result = await db.collection('notas_credito').insertOne({
            negocio_id: negocioId,
            user_id: req.session.userId,
            venta_original_id: venta_id,
            tipo_nota: tipo_nota,
            secuencia_ecf: secuencia,
            codigo_seguridad: codigoSeg,
            monto: montoAbs,
            motivo: motivo.trim(),
            estado_dgii: 'pendiente',
            fecha: getRDDateString()
        });

        res.json({
            id: result.insertedId,
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
router.get('/notas', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const notas = await db.collection('notas_credito').aggregate([
            { $match: { negocio_id: normalizeId(req.session.negocioId) } },
            {
                $lookup: {
                    from: 'ventas',
                    localField: 'venta_original_id',
                    foreignField: '_id',
                    as: 'ventaData'
                }
            },
            { $unwind: { path: '$ventaData', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'clientes',
                    localField: 'ventaData.cliente_id',
                    foreignField: '_id',
                    as: 'clienteData'
                }
            },
            { $unwind: { path: '$clienteData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    id: '$_id',
                    fecha: 1,
                    tipo_nota: 1,
                    secuencia_ecf: 1,
                    monto: 1,
                    motivo: 1,
                    estado_dgii: 1,
                    venta_original_total: '$ventaData.total',
                    secuencia_original: '$ventaData.secuencia_ecf',
                    cliente_nombre: '$clienteData.nombre'
                }
            },
            { $sort: { fecha: -1 } }
        ]).toArray();

        res.json(toPlainArray(notas));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener notas' });
    }
});

module.exports = router;
