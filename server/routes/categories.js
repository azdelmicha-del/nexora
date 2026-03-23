const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function toUpperCase(str) {
    return String(str).toUpperCase();
}

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const categorias = db.prepare(`
            SELECT c.id, c.nombre, c.estado, c.fecha_creacion,
                   COUNT(s.id) as cantidad_servicios
            FROM categorias c
            LEFT JOIN servicios s ON c.id = s.categoria_id AND s.estado = 'activo'
            WHERE c.negocio_id = ?
            GROUP BY c.id
            ORDER BY c.nombre ASC
        `).all(req.session.negocioId);

        res.json(categorias);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const categoria = db.prepare(`
            SELECT c.id, c.nombre, c.estado, c.fecha_creacion
            FROM categorias c
            WHERE c.id = ? AND c.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        res.json(categoria);
    } catch (error) {
        console.error('Error al obtener categoría:', error);
        res.status(500).json({ error: 'Error al obtener categoría' });
    }
});

router.post('/', requireAdmin, (req, res) => {
    try {
        const { nombre, estado } = req.body;

        if (!nombre) {
            return res.status(400).json({ error: 'Nombre es requerido' });
        }

        const nombreNormalizado = toUpperCase(nombre.trim());

        const db = getDb();

        const result = db.prepare(`
            INSERT INTO categorias (negocio_id, nombre, estado)
            VALUES (?, ?, ?)
        `).run(req.session.negocioId, nombreNormalizado, estado || 'activo');

        const categoria = db.prepare('SELECT * FROM categorias WHERE id = ?').get(result.lastInsertRowid);

        res.json(categoria);
    } catch (error) {
        console.error('Error al crear categoría:', error);
        res.status(500).json({ error: 'Error al crear categoría' });
    }
});

router.put('/:id', requireAdmin, (req, res) => {
    try {
        const { nombre, estado } = req.body;
        const categoriaId = req.params.id;

        const db = getDb();

        const categoria = db.prepare('SELECT id FROM categorias WHERE id = ? AND negocio_id = ?')
            .get(categoriaId, req.session.negocioId);

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        const updates = [];
        const values = [];

        if (nombre) {
            updates.push('nombre = ?');
            values.push(toUpperCase(nombre.trim()));
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.push('estado = ?');
            values.push(estado);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(categoriaId);
        db.prepare(`UPDATE categorias SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM categorias WHERE id = ?').get(categoriaId);

        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar categoría:', error);
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const categoriaId = req.params.id;
        const db = getDb();

        const categoria = db.prepare('SELECT id FROM categorias WHERE id = ? AND negocio_id = ?')
            .get(categoriaId, req.session.negocioId);

        if (!categoria) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        db.prepare('DELETE FROM categorias WHERE id = ?').run(categoriaId);

        res.json({ success: true, message: 'Categoría eliminada' });
    } catch (error) {
        console.error('Error al eliminar categoría:', error);
        res.status(500).json({ error: 'Error al eliminar categoría' });
    }
});

module.exports = router;
