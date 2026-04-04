const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { formatters, validators, errorMessages } = require('../utils/validators');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const { estado, buscar } = req.query;

        let query = `
            SELECT c.id, c.nombre, c.telefono, c.email, c.documento, c.tipo_documento, c.notas, c.estado, c.fecha_registro,
                   COUNT(DISTINCT v.id) as total_ventas,
                   COUNT(DISTINCT cit.id) as total_citas
            FROM clientes c
            LEFT JOIN ventas v ON c.id = v.cliente_id
            LEFT JOIN citas cit ON c.id = cit.cliente_id
            WHERE c.negocio_id = ?
        `;
        const params = [negocioId];

        if (estado) {
            query += ' AND c.estado = ?';
            params.push(estado);
        }

        if (buscar) {
            query += ' AND (c.nombre LIKE ? OR c.telefono LIKE ? OR c.email LIKE ?)';
            const term = `%${buscar}%`;
            params.push(term, term, term);
        }

        query += ' GROUP BY c.id ORDER BY c.fecha_registro DESC';

        const clientes = db.prepare(query).all(...params);
        res.json(clientes);
    } catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const cliente = db.prepare(`
            SELECT c.id, c.negocio_id, c.nombre, c.telefono, c.email, c.documento, c.tipo_documento, c.notas, c.estado, c.fecha_registro
            FROM clientes c
            WHERE c.id = ? AND c.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        const ventas = db.prepare(`
            SELECT v.id, v.total, v.metodo_pago, v.fecha
            FROM ventas v
            WHERE v.cliente_id = ? AND v.negocio_id = ?
            ORDER BY v.fecha DESC
            LIMIT 10
        `).all(req.params.id, req.session.negocioId);

        const citas = db.prepare(`
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.estado, s.nombre as servicio
            FROM citas cit
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.cliente_id = ? AND cit.negocio_id = ?
            ORDER BY cit.fecha DESC
            LIMIT 10
        `).all(req.params.id, req.session.negocioId);

        res.json({ ...cliente, ventas, citas });
    } catch (error) {
        console.error('Error al obtener cliente:', error);
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        let { nombre, telefono, email, notas, tipo_documento, documento } = req.body;

        if (!nombre || nombre.trim() === '') {
            return res.status(400).json({ error: 'El nombre es requerido' });
        }

        // Formatear nombre (Title Case)
        nombre = formatters.toTitleCase(nombre);

        if (nombre.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        // Validar teléfono dominicano
        if (!telefono || telefono.trim() === '') {
            return res.status(400).json({ error: 'El celular es requerido' });
        }

        if (!validators.telefonoRD(telefono)) {
            return res.status(400).json({ error: errorMessages.telefonoInvalido });
        }

        telefono = formatters.toPhone(telefono);

        // Formatear y validar email
        if (email) {
            email = formatters.toEmail(email);
            if (!validators.email(email)) {
                return res.status(400).json({ error: errorMessages.emailNoPermitido });
            }
        }

        // Validar documento si se provee
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

        const existente = db.prepare('SELECT id FROM clientes WHERE negocio_id = ? AND telefono = ?')
            .get(req.session.negocioId, telefono);
        if (existente) {
            return res.status(400).json({ error: 'Ya existe un cliente con este teléfono' });
        }

        const result = db.prepare(`
            INSERT INTO clientes (negocio_id, nombre, telefono, email, tipo_documento, documento, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.session.negocioId,
            nombre,
            telefono,
            email || null,
            tipo_documento || null,
            documento,
            notas || null
        );

        const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(result.lastInsertRowid);

        res.json(cliente);
    } catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

router.put('/:id', requireAuth, (req, res) => {
    try {
        let { nombre, telefono, email, notas, estado, tipo_documento, documento } = req.body;
        const clienteId = req.params.id;

        // Formatear nombre (Title Case)
        if (nombre) {
            nombre = formatters.toTitleCase(nombre);
            if (nombre.length > 100) {
                return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
            }
        }

        // Formatear y validar email
        if (email) {
            email = formatters.toEmail(email);
            if (!validators.email(email)) {
                return res.status(400).json({ error: errorMessages.emailNoPermitido });
            }
        }

        // Formatear notas
        if (notas) {
            notas = notas.trim();
        }

        // Validar teléfono dominicano
        if (telefono !== undefined && telefono !== null && telefono !== '') {
            if (!validators.telefonoRD(telefono)) {
                return res.status(400).json({ error: errorMessages.telefonoInvalido });
            }
            telefono = formatters.toPhone(telefono);
        }

        // Validar documento
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

        const cliente = db.prepare('SELECT id FROM clientes WHERE id = ? AND negocio_id = ?')
            .get(clienteId, req.session.negocioId);

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        if (telefono !== undefined && telefono !== null && telefono !== '') {
            const existente = db.prepare('SELECT id FROM clientes WHERE negocio_id = ? AND telefono = ? AND id != ?')
                .get(req.session.negocioId, telefono, clienteId);
            if (existente) {
                return res.status(400).json({ error: 'Ya existe un cliente con este teléfono' });
            }
        }

        const updates = [];
        const values = [];

        if (nombre) {
            updates.push('nombre = ?');
            values.push(nombre);
        }
        if (telefono !== undefined) {
            updates.push('telefono = ?');
            values.push(telefono || null);
        }
        if (email !== undefined) {
            updates.push('email = ?');
            values.push(email || null);
        }
        if (tipo_documento !== undefined) {
            updates.push('tipo_documento = ?');
            values.push(tipo_documento || null);
        }
        if (documento !== undefined) {
            updates.push('documento = ?');
            values.push(documento);
        }
        if (notas !== undefined) {
            updates.push('notas = ?');
            values.push(notas || null);
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.push('estado = ?');
            values.push(estado);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(clienteId);
        db.prepare(`UPDATE clientes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM clientes WHERE id = ?').get(clienteId);
        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar cliente:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const clienteId = req.params.id;
        const db = getDb();

        const cliente = db.prepare('SELECT id FROM clientes WHERE id = ? AND negocio_id = ?')
            .get(clienteId, req.session.negocioId);

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        db.prepare('UPDATE ventas SET cliente_id = NULL WHERE cliente_id = ?').run(clienteId);
        db.prepare('DELETE FROM citas WHERE cliente_id = ?').run(clienteId);
        db.prepare('DELETE FROM clientes WHERE id = ?').run(clienteId);

        res.json({ success: true, message: 'Cliente eliminado' });
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

module.exports = router;
