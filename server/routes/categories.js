const express = require('express');
const { getDb, toPlainId, toPlainArray, normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters } = require('../utils/validators');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const categorias = await db.collection('categorias').aggregate([
            {
                $match: {
                    negocio_id: normalizeId(req.session.negocioId),
                    deleted_at: null
                }
            },
            {
                $lookup: {
                    from: 'servicios',
                    let: { categoriaId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$categoria_id', '$$categoriaId'] },
                                        { $eq: ['$estado', 'activo'] },
                                        { $eq: ['$deleted_at', null] }
                                    ]
                                }
                            }
                        },
                        { $project: { _id: 1 } }
                    ],
                    as: 'servicios'
                }
            },
            {
                $addFields: {
                    cantidad_servicios: { $size: '$servicios' }
                }
            },
            {
                $project: {
                    id: { $toString: '$_id' },
                    nombre: 1,
                    estado: 1,
                    fecha_creacion: 1,
                    cantidad_servicios: 1,
                    _id: 0
                }
            },
            { $sort: { nombre: 1 } }
        ]).toArray();

        res.json(categorias);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const categoria = await db.collection('categorias').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId),
            deleted_at: null
        });

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        res.json(toPlainId(categoria));
    } catch (error) {
        console.error('Error al obtener categoría:', error);
        res.status(500).json({ error: 'Error al obtener categoría' });
    }
});

router.post('/', requireAdmin, async (req, res) => {
    try {
        const { nombre, estado } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Nombre es requerido' });
        }

        const nombreNormalizado = formatters.toTitleCase(nombre.trim());
        const negocioId = normalizeId(req.session.negocioId);

        const db = getDb();

        const doc = {
            negocio_id: negocioId,
            nombre: nombreNormalizado,
            estado: estado || 'activo',
            fecha_creacion: new Date().toISOString()
        };

        const result = await db.collection('categorias').insertOne(doc);

        res.json({
            id: result.insertedId.toString(),
            nombre: nombreNormalizado,
            estado: estado || 'activo',
            fecha_creacion: doc.fecha_creacion
        });
    } catch (error) {
        console.error('Error al crear categoría:', error);
        res.status(500).json({ error: error.message || 'Error al crear categoría' });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { nombre, estado } = req.body;
        const categoriaId = normalizeId(req.params.id);

        const db = getDb();

        const categoria = await db.collection('categorias').findOne({
            _id: categoriaId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        const updates = {};

        if (nombre) {
            updates.nombre = formatters.toTitleCase(nombre.trim());
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.estado = estado;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('categorias').updateOne(
            { _id: categoriaId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: updates }
        );

        const updated = await db.collection('categorias').findOne({
            _id: categoriaId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        res.json(toPlainId(updated));
    } catch (error) {
        console.error('Error al actualizar categoría:', error);
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const categoriaId = normalizeId(req.params.id);
        const db = getDb();

        const categoria = await db.collection('categorias').findOne({
            _id: categoriaId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        if (categoria.estado === 'inactivo') {
            return res.status(400).json({ error: 'Esta categoría ya está desactivada' });
        }

        const tieneServiciosActivos = await db.collection('servicios').findOne({
            categoria_id: categoriaId,
            estado: 'activo'
        });

        if (tieneServiciosActivos) {
            return res.status(400).json({
                error: 'No se puede eliminar esta categoría porque tiene servicios activos. Primero desactive o elimine los servicios.'
            });
        }

        await db.collection('categorias').updateOne(
            { _id: categoriaId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: { estado: 'inactivo' } }
        );

        res.json({ success: true, message: 'Categoría desactivada correctamente' });
    } catch (error) {
        console.error('Error al desactivar categoría:', error);
        res.status(500).json({ error: 'Error al desactivar categoría' });
    }
});

module.exports = router;
