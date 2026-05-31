const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters, validators, errorMessages } = require('../utils/validators');


const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const { estado, buscar } = req.query;

        const matchStage = { negocio_id: negocioId };

        if (estado) {
            matchStage.estado = estado;
        }

        if (buscar) {
            matchStage.$or = [
                { nombre: { $regex: buscar, $options: 'i' } },
                { telefono: { $regex: buscar, $options: 'i' } },
                { email: { $regex: buscar, $options: 'i' } }
            ];
        }

        const clientes = await db.collection('clientes').aggregate([
            { $match: matchStage },
            {
                $lookup: {
                    from: 'ventas',
                    localField: '_id',
                    foreignField: 'cliente_id',
                    as: 'ventas'
                }
            },
            {
                $lookup: {
                    from: 'citas',
                    localField: '_id',
                    foreignField: 'cliente_id',
                    as: 'citas'
                }
            },
            {
                $addFields: {
                    total_ventas: { $size: '$ventas' },
                    total_citas: { $size: '$citas' }
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    nombre: 1,
                    telefono: 1,
                    email: 1,
                    documento: 1,
                    tipo_documento: 1,
                    notas: 1,
                    estado: 1,
                    fecha_registro: 1,
                    total_ventas: 1,
                    total_citas: 1
                }
            },
            { $sort: { fecha_registro: -1 } }
        ]).toArray();

        res.json(clientes);
    } catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const cliente = await db.collection('clientes').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        const ventas = await db.collection('ventas')
            .find({
                cliente_id: normalizeId(req.params.id),
                negocio_id: normalizeId(req.session.negocioId)
            })
            .sort({ fecha: -1 })
            .limit(10)
            .toArray();

        const citas = await db.collection('citas').aggregate([
            {
                $match: {
                    cliente_id: normalizeId(req.params.id),
                    negocio_id: normalizeId(req.session.negocioId)
                }
            },
            {
                $lookup: {
                    from: 'servicios',
                    localField: 'servicio_id',
                    foreignField: '_id',
                    as: 'servicio'
                }
            },
            { $unwind: { path: '$servicio', preserveNullAndEmptyArrays: true } },
            { $sort: { fecha: -1 } },
            { $limit: 10 },
            {
                $project: {
                    id: { $toString: '$_id' },
                    fecha: 1,
                    hora_inicio: 1,
                    estado: 1,
                    servicio: '$servicio.nombre'
                }
            }
        ]).toArray();

        const formattedCliente = {
            id: cliente._id.toString(),
            negocio_id: cliente.negocio_id,
            nombre: cliente.nombre,
            telefono: cliente.telefono,
            email: cliente.email,
            documento: cliente.documento,
            tipo_documento: cliente.tipo_documento,
            notas: cliente.notas,
            estado: cliente.estado,
            fecha_registro: cliente.fecha_registro
        };

        res.json({ ...formattedCliente, ventas, citas });
    } catch (error) {
        console.error('Error al obtener cliente:', error);
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        let { nombre, telefono, email, notas, tipo_documento, documento } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        nombre = formatters.toTitleCase(nombre);

        if (nombre.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        if (!telefono || telefono.trim() === '') {
            return res.status(400).json({ error: 'El celular es requerido' });
        }

        if (!validators.telefonoRD(telefono)) {
            return res.status(400).json({ error: errorMessages.telefonoInvalido });
        }

        telefono = formatters.toPhone(telefono);
        const comparablePhone = formatters.toComparablePhone(telefono);

        if (email) {
            email = formatters.toEmail(email);
            if (!validators.email(email)) {
                return res.status(400).json({ error: errorMessages.emailNoPermitido });
            }
        }

        if (documento) {
            documento = documento.trim();
            const TIPOS_DOC_VALIDOS = ['rnc', 'cedula', 'pasaporte', 'otro'];
            if (tipo_documento && !TIPOS_DOC_VALIDOS.includes(tipo_documento)) {
                return res.status(400).json({ error: 'tipo_documento debe ser: rnc, cedula, pasaporte u otro' });
            }
            if (documento.length > 30) {
                return res.status(400).json({ error: 'El documento no puede exceder 30 caracteres' });
            }
        } else {
            documento = null;
            tipo_documento = null;
        }

        notas = notas ? notas.trim() : null;

        const db = getDb();

        const existente = await db.collection('clientes').findOne({
            negocio_id: normalizeId(req.session.negocioId),
            telefono: { $regex: comparablePhone.replace(/[+\- ]/g, '.*'), $options: 'i' }
        });
        if (existente) {
            return res.status(400).json({ error: 'Ya existe un cliente con este teléfono' });
        }

        const result = await db.collection('clientes').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            nombre,
            telefono,
            email: email || null,
            tipo_documento: tipo_documento || null,
            documento,
            notas: notas || null,
            fecha_registro: new Date()
        });

        const cliente = await db.collection('clientes').findOne({ _id: result.insertedId });

        res.json({ ...cliente, id: cliente._id.toString() });
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

router.put('/:id', requireAuth, async (req, res) => {
    try {
        let { nombre, telefono, email, notas, estado, tipo_documento, documento } = req.body;
        const clienteId = normalizeId(req.params.id);

        if (nombre) {
            nombre = formatters.toTitleCase(nombre);
            if (nombre.length > 100) {
                return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
            }
        }

        if (email) {
            email = formatters.toEmail(email);
            if (!validators.email(email)) {
                return res.status(400).json({ error: errorMessages.emailNoPermitido });
            }
        }

        if (notas) {
            notas = notas.trim();
        }

        if (telefono !== undefined && telefono !== null && telefono !== '') {
            if (!validators.telefonoRD(telefono)) {
                return res.status(400).json({ error: errorMessages.telefonoInvalido });
            }
            telefono = formatters.toPhone(telefono);
        }

        if (documento !== undefined) {
            if (documento !== null && documento !== '') {
                documento = documento.trim();
                const TIPOS_DOC_VALIDOS = ['rnc', 'cedula', 'pasaporte', 'otro'];
                if (tipo_documento && !TIPOS_DOC_VALIDOS.includes(tipo_documento)) {
                    return res.status(400).json({ error: 'tipo_documento debe ser: rnc, cedula, pasaporte u otro' });
                }
                if (documento.length > 30) {
                    return res.status(400).json({ error: 'El documento no puede exceder 30 caracteres' });
                }
            } else {
                documento = null;
                tipo_documento = null;
            }
        }

        const db = getDb();

        const cliente = await db.collection('clientes').findOne({
            _id: clienteId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        if (telefono !== undefined && telefono !== null && telefono !== '') {
            const comparablePhone = formatters.toComparablePhone(telefono);
            const existente = await db.collection('clientes').findOne({
                negocio_id: normalizeId(req.session.negocioId),
                _id: { $ne: clienteId },
                telefono: { $regex: comparablePhone.replace(/[+\- ]/g, '.*'), $options: 'i' }
            });
            if (existente) {
                return res.status(400).json({ error: 'Ya existe un cliente con este teléfono' });
            }
        }

        const updates = {};

        if (nombre) {
            updates.nombre = nombre;
        }
        if (telefono !== undefined) {
            updates.telefono = telefono || null;
        }
        if (email !== undefined) {
            updates.email = email || null;
        }
        if (tipo_documento !== undefined) {
            updates.tipo_documento = tipo_documento || null;
        }
        if (documento !== undefined) {
            updates.documento = documento;
        }
        if (notas !== undefined) {
            updates.notas = notas || null;
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.estado = estado;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('clientes').updateOne(
            { _id: clienteId },
            { $set: updates }
        );

        const updated = await db.collection('clientes').findOne({ _id: clienteId });
        res.json({ ...updated, id: updated._id.toString() });
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const clienteId = normalizeId(req.params.id);
        const db = getDb();

        const cliente = await db.collection('clientes').findOne({
            _id: clienteId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        const negocioId = normalizeId(req.session.negocioId);
        const clienteObjectId = clienteId;

        const session = await db.getClient().startSession();
        try {
            await session.withTransaction(async () => {
                await db.collection('ventas').updateMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { $set: { cliente_id: null } },
                    { session }
                );
                await db.collection('pedidos').updateMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { $set: { cliente_id: null } },
                    { session }
                );
                await db.collection('conversaciones').updateMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { $set: { cliente_id: null } },
                    { session }
                );
                await db.collection('chatbot_mensajes').updateMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { $set: { cliente_id: null } },
                    { session }
                );
                await db.collection('historial_puntos').deleteMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { session }
                );
                await db.collection('puntos_lealtad').deleteMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { session }
                );
                await db.collection('citas').deleteMany(
                    { cliente_id: clienteObjectId, negocio_id: negocioId },
                    { session }
                );
                await db.collection('clientes').deleteOne(
                    { _id: clienteObjectId, negocio_id: negocioId },
                    { session }
                );
            });
        } finally {
            await session.endSession();
        }

        res.json({ success: true, message: 'Cliente eliminado' });
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

module.exports = router;
