const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters } = require('../utils/validators');

const router = express.Router();
const ITBIS_PERMITIDOS = [0, 8, 16, 18];

const toId = (doc) => {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return { id: _id.toString(), ...rest };
};

const toIdArray = (docs) => docs.map(toId);

// GET /api/products — Listar productos activos (no borrados)
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const productos = await db.collection('productos').find({
            negocio_id: normalizeId(req.session.negocioId),
            estado: 'activo',
            deleted_at: null
        }).sort({ nombre: 1 }).toArray();

        res.json(toIdArray(productos));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// GET /api/products/low-stock — Productos con stock bajo
router.get('/low-stock', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const productos = await db.collection('productos').find({
            negocio_id: normalizeId(req.session.negocioId),
            estado: 'activo',
            deleted_at: null,
            $expr: { $lte: ['$stock', '$stock_minimo'] }
        }).sort({ stock: 1 }).toArray();

        res.json(toIdArray(productos));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener stock bajo' });
    }
});

// GET /api/products/:id — Detalle de producto
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const producto = await db.collection('productos').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId),
            deleted_at: null
        });

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const movimientos = await db.collection('movimientos_inventario').aggregate([
            { $match: { producto_id: normalizeId(req.params.id) } },
            {
                $lookup: {
                    from: 'usuarios',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'usuarioDoc'
                }
            },
            { $unwind: { path: '$usuarioDoc', preserveNullAndEmptyArrays: true } },
            { $addFields: { usuario: '$usuarioDoc.nombre' } },
            { $project: { usuarioDoc: 0 } },
            { $sort: { fecha: -1 } },
            { $limit: 20 }
        ]).toArray();

        res.json({ ...toId(producto), movimientos: toIdArray(movimientos) });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener producto' });
    }
});

// POST /api/products — Crear producto
router.post('/', requireAuth, async (req, res) => {
    try {
        let { nombre, descripcion, precio, costo, stock, stock_minimo, codigo_barras, categoria, itbis_tasa } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        nombre = formatters.toTitleCase(nombre.trim());
        precio = parseFloat(precio);
        if (isNaN(precio) || precio < 0) {
            return res.status(400).json({ error: 'Precio debe ser un numero positivo' });
        }

        costo = parseFloat(costo) || 0;
        stock = parseInt(stock) || 0;
        stock_minimo = parseInt(stock_minimo) || 5;
        itbis_tasa = (itbis_tasa !== undefined && itbis_tasa !== null)
            ? parseInt(itbis_tasa, 10)
            : 18;
        if (!ITBIS_PERMITIDOS.includes(itbis_tasa)) {
            return res.status(400).json({ error: 'itbis_tasa debe ser 0, 8, 16 o 18' });
        }

        const db = getDb();

        const result = await db.collection('productos').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            nombre,
            descripcion: descripcion ? descripcion.trim() : null,
            precio,
            costo,
            stock,
            stock_minimo,
            codigo_barras: codigo_barras ? codigo_barras.trim() : null,
            categoria: categoria ? categoria.trim() : null,
            itbis_tasa,
            estado: 'activo',
            deleted_at: null,
            fecha_creacion: new Date().toISOString()
        });

        // Registrar movimiento de entrada inicial si hay stock
        if (stock > 0) {
            await db.collection('movimientos_inventario').insertOne({
                negocio_id: normalizeId(req.session.negocioId),
                producto_id: result.insertedId.toString(),
                tipo: 'entrada',
                cantidad: stock,
                costo_unitario: costo,
                user_id: req.session.userId
            });
        }

        const producto = await db.collection('productos').findOne({ _id: result.insertedId });
        res.json(toId(producto));
    } catch (error) {
        console.error('Error al crear producto:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// PUT /api/products/:id — Actualizar producto
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { nombre, descripcion, precio, costo, stock, stock_minimo, codigo_barras, categoria, itbis_tasa, estado } = req.body;
        const productoId = normalizeId(req.params.id);
        const db = getDb();

        const producto = await db.collection('productos').findOne({
            _id: productoId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const updates = {};

        if (nombre !== undefined) {
            updates.nombre = formatters.toTitleCase(nombre.trim());
        }
        if (descripcion !== undefined) {
            updates.descripcion = descripcion ? descripcion.trim() : null;
        }
        if (precio !== undefined) {
            updates.precio = parseFloat(precio);
        }
        if (costo !== undefined) {
            updates.costo = parseFloat(costo) || 0;
        }
        if (stock !== undefined) {
            const nuevoStock = parseInt(stock);
            const stockAnterior = producto.stock;
            const diff = nuevoStock - stockAnterior;

            updates.stock = nuevoStock;

            // Registrar movimiento si cambio el stock
            if (diff !== 0) {
                await db.collection('movimientos_inventario').insertOne({
                    negocio_id: normalizeId(req.session.negocioId),
                    producto_id: productoId,
                    tipo: diff > 0 ? 'entrada' : 'salida',
                    cantidad: Math.abs(diff),
                    costo_unitario: parseFloat(costo) || 0,
                    user_id: req.session.userId
                });
            }
        }
        if (stock_minimo !== undefined) {
            updates.stock_minimo = parseInt(stock_minimo);
        }
        if (codigo_barras !== undefined) {
            updates.codigo_barras = codigo_barras ? codigo_barras.trim() : null;
        }
        if (categoria !== undefined) {
            updates.categoria = categoria ? categoria.trim() : null;
        }
        if (itbis_tasa !== undefined) {
            const tasaPUT = parseInt(itbis_tasa, 10);
            if (!ITBIS_PERMITIDOS.includes(tasaPUT)) {
                return res.status(400).json({ error: 'itbis_tasa debe ser 0, 8, 16 o 18' });
            }
            updates.itbis_tasa = tasaPUT;
        }
        if (estado !== undefined) {
            updates.estado = estado;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('productos').updateOne(
            { _id: productoId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: updates }
        );

        const updated = await db.collection('productos').findOne({
            _id: productoId,
            negocio_id: normalizeId(req.session.negocioId)
        });
        res.json(toId(updated));
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /api/products/:id — Soft delete (marked as deleted)
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const producto = await db.collection('productos').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const session = await db.startSession();
        await session.withTransaction(async () => {
            await db.collection('productos').updateOne(
                { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) },
                { $set: { deleted_at: new Date().toISOString() } }
            );
        });
        await session.endSession();

        res.json({ success: true, message: 'Producto eliminado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// POST /api/products/:id/ajustar-stock — Ajuste manual de stock
router.post('/:id/ajustar-stock', requireAuth, async (req, res) => {
    try {
        const { cantidad, motivo } = req.body;
        const db = getDb();

        const producto = await db.collection('productos').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const cantidadInt = parseInt(cantidad);
        if (isNaN(cantidadInt)) {
            return res.status(400).json({ error: 'Cantidad invalida' });
        }

        const nuevoStock = producto.stock + cantidadInt;
        if (nuevoStock < 0) {
            return res.status(400).json({ error: 'Stock no puede ser negativo' });
        }

        await db.collection('productos').updateOne(
            { _id: normalizeId(req.params.id), negocio_id: normalizeId(req.session.negocioId) },
            { $set: { stock: nuevoStock } }
        );

        await db.collection('movimientos_inventario').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            producto_id: normalizeId(req.params.id),
            tipo: 'ajuste',
            cantidad: Math.abs(cantidadInt),
            referencia: motivo ? motivo.trim() : 'Ajuste manual',
            user_id: req.session.userId
        });

        res.json({ success: true, stock_anterior: producto.stock, stock_nuevo: nuevoStock });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al ajustar stock' });
    }
});

module.exports = router;
