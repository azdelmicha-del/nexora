const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters } = require('../utils/validators');

const router = express.Router();
const ITBIS_PERMITIDOS = [0, 8, 16, 18];

// GET /api/products — Listar productos
router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { buscar, categoria, estado } = req.query;

        let query = `
            SELECT p.*, 
                   (SELECT COUNT(*) FROM movimientos_inventario WHERE producto_id = p.id) as total_movimientos
            FROM productos p
            WHERE p.negocio_id = ?
        `;
        const params = [negocioId];

        if (buscar) {
            const term = `%${buscar}%`;
            query += ' AND (p.nombre LIKE ? OR p.codigo_barras LIKE ?)';
            params.push(term, term);
        }
        if (categoria) {
            query += ' AND p.categoria = ?';
            params.push(categoria);
        }
        if (estado) {
            query += ' AND p.estado = ?';
            params.push(estado);
        }

        query += ' ORDER BY p.nombre ASC';

        const productos = db.prepare(query).all(...params);
        res.json(productos);
    } catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// GET /api/products/:id — Detalle de producto
router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const producto = db.prepare(`
            SELECT * FROM productos
            WHERE id = ? AND negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const movimientos = db.prepare(`
            SELECT m.*, u.nombre as usuario
            FROM movimientos_inventario m
            LEFT JOIN usuarios u ON m.user_id = u.id
            WHERE m.producto_id = ?
            ORDER BY m.fecha DESC
            LIMIT 20
        `).all(req.params.id);

        res.json({ ...producto, movimientos });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener producto' });
    }
});

// POST /api/products — Crear producto
router.post('/', requireAuth, (req, res) => {
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

        const result = db.prepare(`
            INSERT INTO productos (negocio_id, nombre, descripcion, precio, costo, stock, stock_minimo, codigo_barras, categoria, itbis_tasa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            nombre,
            descripcion ? descripcion.trim() : null,
            precio,
            costo,
            stock,
            stock_minimo,
            codigo_barras ? codigo_barras.trim() : null,
            categoria ? categoria.trim() : null,
            itbis_tasa
        );

        // Registrar movimiento de entrada inicial si hay stock
        if (stock > 0) {
            db.prepare(`
                INSERT INTO movimientos_inventario (negocio_id, producto_id, tipo, cantidad, costo_unitario, user_id)
                VALUES (?, ?, 'entrada', ?, ?, ?)
            `).run(req.session.negocioId, result.lastInsertRowid, stock, costo, req.session.userId);
        }

        const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(result.lastInsertRowid);
        res.json(producto);
    } catch (error) {
        console.error('Error al crear producto:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// PUT /api/products/:id — Actualizar producto
router.put('/:id', requireAuth, (req, res) => {
    try {
        const { nombre, descripcion, precio, costo, stock, stock_minimo, codigo_barras, categoria, itbis_tasa, estado } = req.body;
        const productoId = req.params.id;
        const db = getDb();

        const producto = db.prepare('SELECT id, stock FROM productos WHERE id = ? AND negocio_id = ?')
            .get(productoId, req.session.negocioId);

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const updates = [];
        const values = [];

        if (nombre !== undefined) {
            updates.push('nombre = ?');
            values.push(formatters.toTitleCase(nombre.trim()));
        }
        if (descripcion !== undefined) {
            updates.push('descripcion = ?');
            values.push(descripcion ? descripcion.trim() : null);
        }
        if (precio !== undefined) {
            updates.push('precio = ?');
            values.push(parseFloat(precio));
        }
        if (costo !== undefined) {
            updates.push('costo = ?');
            values.push(parseFloat(costo) || 0);
        }
        if (stock !== undefined) {
            const nuevoStock = parseInt(stock);
            const stockAnterior = producto.stock;
            const diff = nuevoStock - stockAnterior;

            updates.push('stock = ?');
            values.push(nuevoStock);

            // Registrar movimiento si cambio el stock
            if (diff !== 0) {
                db.prepare(`
                    INSERT INTO movimientos_inventario (negocio_id, producto_id, tipo, cantidad, costo_unitario, user_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    req.session.negocioId,
                    productoId,
                    diff > 0 ? 'entrada' : 'salida',
                    Math.abs(diff),
                    parseFloat(costo) || 0,
                    req.session.userId
                );
            }
        }
        if (stock_minimo !== undefined) {
            updates.push('stock_minimo = ?');
            values.push(parseInt(stock_minimo));
        }
        if (codigo_barras !== undefined) {
            updates.push('codigo_barras = ?');
            values.push(codigo_barras ? codigo_barras.trim() : null);
        }
        if (categoria !== undefined) {
            updates.push('categoria = ?');
            values.push(categoria ? categoria.trim() : null);
        }
        if (itbis_tasa !== undefined) {
            const tasaPUT = parseInt(itbis_tasa, 10);
            if (!ITBIS_PERMITIDOS.includes(tasaPUT)) {
                return res.status(400).json({ error: 'itbis_tasa debe ser 0, 8, 16 o 18' });
            }
            updates.push('itbis_tasa = ?');
            values.push(tasaPUT);
        }
        if (estado !== undefined) {
            updates.push('estado = ?');
            values.push(estado);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(productoId);
        db.prepare(`UPDATE productos SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM productos WHERE id = ?').get(productoId);
        res.json(updated);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /api/products/:id — Eliminar producto
router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const producto = db.prepare('SELECT id FROM productos WHERE id = ? AND negocio_id = ?')
            .get(req.params.id, req.session.negocioId);

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        db.prepare('DELETE FROM movimientos_inventario WHERE producto_id = ?').run(req.params.id);
        db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);

        res.json({ success: true, message: 'Producto eliminado' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// POST /api/products/:id/ajustar-stock — Ajuste manual de stock
router.post('/:id/ajustar-stock', requireAuth, (req, res) => {
    try {
        const { cantidad, motivo } = req.body;
        const db = getDb();

        const producto = db.prepare('SELECT id, stock FROM productos WHERE id = ? AND negocio_id = ?')
            .get(req.params.id, req.session.negocioId);

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

        db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevoStock, req.params.id);

        db.prepare(`
            INSERT INTO movimientos_inventario (negocio_id, producto_id, tipo, cantidad, referencia, user_id)
            VALUES (?, ?, 'ajuste', ?, ?, ?)
        `).run(
            req.session.negocioId,
            req.params.id,
            Math.abs(cantidadInt),
            motivo ? motivo.trim() : 'Ajuste manual',
            req.session.userId
        );

        res.json({ success: true, stock_anterior: producto.stock, stock_nuevo: nuevoStock });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al ajustar stock' });
    }
});

// GET /api/products/low-stock — Productos con stock bajo
router.get('/low-stock', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const productos = db.prepare(`
            SELECT * FROM productos
            WHERE negocio_id = ? AND stock <= stock_minimo AND estado = 'activo'
            ORDER BY stock ASC
        `).all(req.session.negocioId);

        res.json(productos);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener stock bajo' });
    }
});

module.exports = router;
