const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── Categorias del Menu ─────────────────────────────────────────────────────

router.get('/categorias', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const cats = db.prepare(`
            SELECT mc.*, COUNT(mi.id) as items_count
            FROM menu_categorias mc
            LEFT JOIN menu_items mi ON mi.categoria_id = mc.id AND mi.disponible = 1
            WHERE mc.negocio_id = ?
            GROUP BY mc.id
            ORDER BY mc.orden ASC
        `).all(req.session.negocioId);
        res.json(cats);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener categorias' });
    }
});

router.post('/categorias', requireAuth, (req, res) => {
    try {
        const { nombre, orden } = req.body;
        if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
        const db = getDb();
        const result = db.prepare('INSERT INTO menu_categorias (negocio_id, nombre, orden) VALUES (?, ?, ?)')
            .run(req.session.negocioId, nombre.trim(), parseInt(orden) || 0);
        res.json({ id: result.lastInsertRowid, nombre: nombre.trim(), orden: parseInt(orden) || 0 });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al crear categoria' });
    }
});

router.put('/categorias/:id', requireAuth, (req, res) => {
    try {
        const { nombre, orden, activa } = req.body;
        const db = getDb();
        const updates = [];
        const params = [];
        if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre.trim()); }
        if (orden !== undefined) { updates.push('orden = ?'); params.push(parseInt(orden)); }
        if (activa !== undefined) { updates.push('activa = ?'); params.push(activa ? 1 : 0); }
        if (updates.length === 0) return res.status(400).json({ error: 'No hay campos' });
        params.push(req.params.id, req.session.negocioId);
        db.prepare(`UPDATE menu_categorias SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`).run(...params);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar categoria' });
    }
});

router.delete('/categorias/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM menu_categorias WHERE id = ? AND negocio_id = ?').run(req.params.id, req.session.negocioId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar categoria' });
    }
});

// ── Items del Menu ──────────────────────────────────────────────────────────

router.get('/items', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const items = db.prepare(`
            SELECT mi.*, mc.nombre as categoria_nombre
            FROM menu_items mi
            LEFT JOIN menu_categorias mc ON mi.categoria_id = mc.id
            WHERE mi.negocio_id = ?
            ORDER BY mi.destacado DESC, mi.nombre ASC
        `).all(req.session.negocioId);
        res.json(items);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener items' });
    }
});

router.post('/items', requireAuth, (req, res) => {
    try {
        const { categoria_id, nombre, descripcion, precio, imagen, itbis_tasa, destacado } = req.body;
        if (!nombre || !precio) return res.status(400).json({ error: 'Nombre y precio requeridos' });
        const db = getDb();
        const result = db.prepare(`
            INSERT INTO menu_items (negocio_id, categoria_id, nombre, descripcion, precio, imagen, itbis_tasa, destacado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.session.negocioId, categoria_id || null, nombre.trim(), descripcion ? descripcion.trim() : null,
            parseFloat(precio), imagen || null, parseInt(itbis_tasa) || 18, destacado ? 1 : 0);
        res.json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al crear item' });
    }
});

router.put('/items/:id', requireAuth, (req, res) => {
    try {
        const { nombre, descripcion, precio, imagen, disponible, itbis_tasa, destacado, categoria_id } = req.body;
        const db = getDb();
        const updates = [];
        const params = [];
        if (nombre !== undefined) { updates.push('nombre = ?'); params.push(nombre.trim()); }
        if (descripcion !== undefined) { updates.push('descripcion = ?'); params.push(descripcion ? descripcion.trim() : null); }
        if (precio !== undefined) { updates.push('precio = ?'); params.push(parseFloat(precio)); }
        if (imagen !== undefined) { updates.push('imagen = ?'); params.push(imagen || null); }
        if (disponible !== undefined) { updates.push('disponible = ?'); params.push(disponible ? 1 : 0); }
        if (itbis_tasa !== undefined) { updates.push('itbis_tasa = ?'); params.push(parseInt(itbis_tasa)); }
        if (destacado !== undefined) { updates.push('destacado = ?'); params.push(destacado ? 1 : 0); }
        if (categoria_id !== undefined) { updates.push('categoria_id = ?'); params.push(categoria_id || null); }
        if (updates.length === 0) return res.status(400).json({ error: 'No hay campos' });
        params.push(req.params.id, req.session.negocioId);
        db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`).run(...params);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar item' });
    }
});

router.delete('/items/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        db.prepare('DELETE FROM menu_items WHERE id = ? AND negocio_id = ?').run(req.params.id, req.session.negocioId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar item' });
    }
});

// ── Config Delivery ─────────────────────────────────────────────────────────

router.get('/config', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT delivery_activo, delivery_costo, delivery_tiempo, delivery_minimo FROM negocios WHERE id = ?')
            .get(req.session.negocioId);
        res.json(config || { delivery_activo: 0, delivery_costo: 0, delivery_tiempo: 30, delivery_minimo: 0 });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener config delivery' });
    }
});

router.put('/config', requireAuth, (req, res) => {
    try {
        const { delivery_activo, delivery_costo, delivery_tiempo, delivery_minimo } = req.body;
        const db = getDb();
        db.prepare(`
            UPDATE negocios SET delivery_activo=?, delivery_costo=?, delivery_tiempo=?, delivery_minimo=?
            WHERE id=?
        `).run(delivery_activo?1:0, parseFloat(delivery_costo)||0, parseInt(delivery_tiempo)||30, parseFloat(delivery_minimo)||0, req.session.negocioId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar config' });
    }
});

module.exports = router;
