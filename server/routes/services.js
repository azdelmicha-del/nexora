const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters } = require('../utils/validators');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { estado, categoria } = req.query;

        let query = `
            SELECT s.id, s.nombre, s.precio, s.duracion, s.categoria_id,
                   s.descripcion, s.estado, s.fecha_creacion, s.imagen,
                   s.itbis_tasa, s.costo_insumo_estimado, s.comision_porcentaje,
                   c.nombre as categoria
            FROM servicios s
            LEFT JOIN categorias c ON s.categoria_id = c.id
            WHERE s.negocio_id = ?
        `;
        const params = [negocioId];

        // Por defecto solo mostrar servicios activos
        if (estado) {
            query += ' AND s.estado = ?';
            params.push(estado);
        } else {
            query += ' AND s.estado = ?';
            params.push('activo');
        }

        if (categoria) {
            query += ' AND s.categoria_id = ?';
            params.push(categoria);
        }

        query += ' ORDER BY s.nombre ASC';

        const servicios = db.prepare(query).all(...params);
        res.json(servicios);
    } catch (error) {
        console.error('Error al obtener servicios:', error);
        res.status(500).json({ error: 'Error al obtener servicios' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const servicio = db.prepare(`
            SELECT s.id, s.negocio_id, s.nombre, s.precio, s.duracion,
                   s.categoria_id, s.descripcion, s.estado, s.fecha_creacion, s.imagen,
                   s.itbis_tasa, s.costo_insumo_estimado, s.comision_porcentaje,
                   c.nombre as categoria
            FROM servicios s
            LEFT JOIN categorias c ON s.categoria_id = c.id
            WHERE s.id = ? AND s.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        res.json(servicio);
    } catch (error) {
        console.error('Error al obtener servicio:', error);
        res.status(500).json({ error: 'Error al obtener servicio' });
    }
});

router.post('/', requireAdmin, (req, res) => {
    try {
        let { nombre, precio, duracion, categoria_id, descripcion, estado, imagen,
              itbis_tasa, costo_insumo_estimado, comision_porcentaje } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        nombre = formatters.capitalize(nombre.trim());
        descripcion = descripcion ? descripcion.trim() : null;

        if (precio === undefined || precio === null || isNaN(precio)) {
            return res.status(400).json({ error: 'El precio debe ser un número válido' });
        }

        if (parseFloat(precio) < 0) {
            return res.status(400).json({ error: 'El precio no puede ser negativo' });
        }

        if (!duracion || isNaN(duracion) || parseInt(duracion) < 1) {
            return res.status(400).json({ error: 'La duración debe ser al menos 1 minuto' });
        }

        if (nombre.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        if (imagen && imagen.length > 1000000) {
            return res.status(400).json({ error: 'La imagen es demasiado grande después de procesar. Intenta con una foto más pequeña.' });
        }

        // Validar itbis_tasa: solo valores permitidos por la DGII (0, 8, 16, 18)
        const TASAS_VALIDAS = [0, 8, 16, 18];
        const tasaFinal = (itbis_tasa !== undefined && itbis_tasa !== null)
            ? parseInt(itbis_tasa, 10)
            : 18;
        if (!TASAS_VALIDAS.includes(tasaFinal)) {
            return res.status(400).json({ error: 'itbis_tasa debe ser 0, 8, 16 o 18' });
        }

        const costoFinal = Math.max(0, parseFloat(costo_insumo_estimado) || 0);
        const comisionFinal = Math.max(0, Math.min(100, parseFloat(comision_porcentaje) || 0));

        const db = getDb();

        const result = db.prepare(`
            INSERT INTO servicios (
                negocio_id, nombre, precio, duracion, categoria_id,
                descripcion, estado, imagen,
                itbis_tasa, costo_insumo_estimado, comision_porcentaje
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            nombre,
            precio,
            duracion,
            categoria_id || null,
            descripcion,
            estado || 'activo',
            imagen || null,
            tasaFinal,
            costoFinal,
            comisionFinal
        );

        const servicio = db.prepare(`
            SELECT s.id, s.nombre, s.precio, s.duracion, s.categoria_id,
                   s.descripcion, s.estado, s.fecha_creacion, s.imagen,
                   s.itbis_tasa, s.costo_insumo_estimado, s.comision_porcentaje, s.comision_porcentaje,
                   c.nombre as categoria
            FROM servicios s
            LEFT JOIN categorias c ON s.categoria_id = c.id
            WHERE s.id = ?
        `).get(result.lastInsertRowid);

        res.json(servicio);
    } catch (error) {
        console.error('Error al crear servicio:', error);
        res.status(500).json({ error: 'Error al crear servicio' });
    }
});

router.put('/:id', requireAdmin, (req, res) => {
    try {
        let { nombre, precio, duracion, categoria_id, descripcion, estado, imagen,
              itbis_tasa, costo_insumo_estimado, comision_porcentaje } = req.body;
        const servicioId = req.params.id;

        if (nombre) {
            nombre = formatters.capitalize(nombre.trim());
        }
        if (descripcion) {
            descripcion = descripcion.trim();
        }

        if (nombre && nombre.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        if (precio !== undefined) {
            if (isNaN(precio)) {
                return res.status(400).json({ error: 'El precio debe ser un número válido' });
            }
            if (parseFloat(precio) < 0) {
                return res.status(400).json({ error: 'El precio no puede ser negativo' });
            }
        }

        if (duracion !== undefined) {
            if (isNaN(duracion) || parseInt(duracion) < 1) {
                return res.status(400).json({ error: 'La duración debe ser al menos 1 minuto' });
            }
        }

        const db = getDb();

        const servicio = db.prepare('SELECT id FROM servicios WHERE id = ? AND negocio_id = ?')
            .get(servicioId, req.session.negocioId);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        const updates = [];
        const values = [];

        if (nombre) {
            updates.push('nombre = ?');
            values.push(nombre);
        }
        if (precio !== undefined) {
            updates.push('precio = ?');
            values.push(precio);
        }
        if (duracion) {
            updates.push('duracion = ?');
            values.push(duracion);
        }
        if (categoria_id !== undefined) {
            updates.push('categoria_id = ?');
            values.push(categoria_id || null);
        }
        if (descripcion !== undefined) {
            updates.push('descripcion = ?');
            values.push(descripcion || null);
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.push('estado = ?');
            values.push(estado);
        }
        if (imagen !== undefined) {
            if (imagen && imagen.length > 1000000) {
                return res.status(400).json({ error: 'La imagen es demasiado grande después de procesar. Intenta con una foto más pequeña.' });
            }
            updates.push('imagen = ?');
            values.push(imagen || null);
        }

        // Campos fiscales
        if (itbis_tasa !== undefined) {
            const TASAS_VALIDAS = [0, 8, 16, 18];
            const tasaPUT = parseInt(itbis_tasa, 10);
            if (!TASAS_VALIDAS.includes(tasaPUT)) {
                return res.status(400).json({ error: 'itbis_tasa debe ser 0, 8, 16 o 18' });
            }
            updates.push('itbis_tasa = ?');
            values.push(tasaPUT);
        }
        if (costo_insumo_estimado !== undefined) {
            updates.push('costo_insumo_estimado = ?');
            values.push(Math.max(0, parseFloat(costo_insumo_estimado) || 0));
        }
        if (comision_porcentaje !== undefined) {
            updates.push('comision_porcentaje = ?');
            values.push(Math.max(0, Math.min(100, parseFloat(comision_porcentaje) || 0)));
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(servicioId);
        db.prepare(`UPDATE servicios SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare(`
            SELECT s.id, s.nombre, s.precio, s.duracion, s.categoria_id,
                   s.descripcion, s.estado, s.fecha_creacion, s.imagen,
                   s.itbis_tasa, s.costo_insumo_estimado, s.comision_porcentaje,
                   c.nombre as categoria
            FROM servicios s
            LEFT JOIN categorias c ON s.categoria_id = c.id
            WHERE s.id = ?
        `).get(servicioId);

        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar servicio:', error);
        res.status(500).json({ error: 'Error al actualizar servicio' });
    }
});

router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const servicioId = req.params.id;
        const db = getDb();

        const servicio = db.prepare('SELECT id, estado FROM servicios WHERE id = ? AND negocio_id = ?')
            .get(servicioId, req.session.negocioId);

        if (!servicio) {
            return res.status(404).json({ error: 'Servicio no encontrado' });
        }

        if (servicio.estado === 'inactivo') {
            return res.status(400).json({ error: 'Este servicio ya está desactivado' });
        }

        // Verificar si tiene citas activas (pendiente, confirmada, en_proceso)
        const tieneCitasActivas = db.prepare(`
            SELECT id FROM citas 
            WHERE servicio_id = ? AND negocio_id = ? 
            AND estado IN ('pendiente', 'confirmada', 'en_proceso')
        `).get(servicioId, req.session.negocioId);

        if (tieneCitasActivas) {
            return res.status(400).json({ 
                error: 'No se puede desactivar este servicio porque tiene citas activas. Primero cancele o finalice las citas pendientes.' 
            });
        }

        // Soft delete: cambiar estado a inactivo
        db.prepare("UPDATE servicios SET estado = 'inactivo' WHERE id = ? AND negocio_id = ?")
            .run(servicioId, req.session.negocioId);

        res.json({ success: true, message: 'Servicio desactivado correctamente' });
    } catch (error) {
        console.error('Error al desactivar servicio:', error);
        res.status(500).json({ error: 'Error al desactivar servicio' });
    }
});

module.exports = router;
