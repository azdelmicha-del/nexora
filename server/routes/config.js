const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM negocios WHERE id = ?').get(req.session.negocioId);

        if (!config) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        res.json(config);
    } catch (error) {
        console.error('Error al obtener configuración:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.put('/', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;

        const camposPermitidos = [
            'nombre', 'telefono', 'email', 'direccion', 'logo',
            'moneda', 'formato_moneda', 'hora_apertura', 'hora_cierre',
            'dias_laborales', 'duracion_minima_cita', 'permitir_solapamiento',
            'tiempo_anticipacion', 'tiempo_cancelacion', 'mostrar_impuestos',
            'activar_descuentos', 'seleccion_obligatoria_cliente',
            'metodo_efectivo', 'metodo_transferencia', 'metodo_tarjeta',
            'chatbot_activo', 'chatbot_bienvenida', 'notificaciones_activas', 'booking_activo',
            'buffer_entre_citas'
        ];

        const updates = [];
        const values = [];

        for (const campo of camposPermitidos) {
            if (req.body[campo] !== undefined) {
                updates.push(`${campo} = ?`);
                values.push(req.body[campo]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(negocioId);
        db.prepare(`UPDATE negocios SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM negocios WHERE id = ?').get(negocioId);
        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar configuración:', error);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

router.get('/dashboard', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const ahora = new Date();
        const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;

        // La caja siempre está abierta para nuevas ventas
        const clientesNuevos = db.prepare(`
            SELECT COUNT(*) as cantidad
            FROM clientes
            WHERE negocio_id = ? AND DATE(fecha_registro) = ?
        `).get(negocioId, hoy);

        const totalClientes = db.prepare(`
            SELECT COUNT(*) as cantidad FROM clientes WHERE negocio_id = ? AND estado = 'activo'
        `).get(negocioId);

        const serviciosActivos = db.prepare(`
            SELECT COUNT(*) as cantidad FROM servicios WHERE negocio_id = ? AND estado = 'activo'
        `).get(negocioId);

        let ventasHoy = { total: 0, cantidad: 0 };
        let citasHoy = { cantidad: 0 };
        let ultimasVentas = [];
        let ultimasCitas = [];

        // La caja siempre está abierta - cargar datos siempre
        ventasHoy = db.prepare(`
                SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad
                FROM ventas
                WHERE negocio_id = ? AND DATE(fecha) = ?
            `).get(negocioId, hoy);

            citasHoy = db.prepare(`
                SELECT COUNT(*) as cantidad
                FROM citas
                WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
            `).get(negocioId, hoy);

            ultimasVentas = db.prepare(`
                SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
                FROM ventas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.negocio_id = ?
                ORDER BY v.fecha DESC
                LIMIT 5
            `).all(negocioId);

        ultimasCitas = db.prepare(`
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.estado, cl.nombre as cliente, s.nombre as servicio
            FROM citas cit
            JOIN clientes cl ON cit.cliente_id = cl.id
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.negocio_id = ?
            ORDER BY cit.fecha DESC, cit.hora_inicio DESC
            LIMIT 5
        `).all(negocioId);

        res.json({
            hoy: {
                ventas: ventasHoy,
                citas: citasHoy,
                clientesNuevos: clientesNuevos
            },
            resumen: {
                totalClientes: totalClientes.cantidad,
                serviciosActivos: serviciosActivos.cantidad
            },
            ultimasVentas,
            ultimasCitas,
            caja_cerrada: false // Siempre abierta para nuevas ventas
        });
    } catch (error) {
        console.error('Error al obtener dashboard:', error);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
});

// Obtener slug del negocio
router.get('/slug', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT slug, booking_activo FROM negocios WHERE id = ?')
            .get(req.session.negocioId);
        res.json(negocio || { slug: null, booking_activo: 1 });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// Actualizar slug del negocio
router.put('/slug', requireAdmin, (req, res) => {
    try {
        const { slug } = req.body;
        const db = getDb();
        
        if (!slug || slug.length < 3) {
            return res.status(400).json({ error: 'Slug muy corto (minimo 3 caracteres)' });
        }
        
        const slugLimpio = slug.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/^-+|-+$/g, '');
        
        const exist = db.prepare('SELECT id FROM negocios WHERE slug = ? AND id != ?')
            .get(slugLimpio, req.session.negocioId);
        
        if (exist) {
            return res.status(400).json({ error: 'Este link ya esta en uso' });
        }
        
        db.prepare('UPDATE negocios SET slug = ? WHERE id = ?')
            .run(slugLimpio, req.session.negocioId);
        
        res.json({ success: true, slug: slugLimpio });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

module.exports = router;
