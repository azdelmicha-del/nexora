const express = require('express');
const { getDb } = require('../database');
const router = express.Router();

router.get('/business/:slug', (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare(`
            SELECT id, nombre, slug, telefono, direccion, logo,
                   hora_apertura, hora_cierre, dias_laborales, booking_activo
            FROM negocios WHERE slug = ? AND estado = 'activo'
        `).get(req.params.slug);

        if (!negocio || !negocio.booking_activo) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        const categorias = db.prepare(`
            SELECT c.id, c.nombre, json_group_array(json_object(
                'id', s.id, 'nombre', s.nombre, 'precio', s.precio, 
                'duracion', s.duracion, 'descripcion', s.descripcion
            )) as servicios
            FROM categorias c
            LEFT JOIN servicios s ON s.categoria_id = c.id AND s.estado = 'activo'
            WHERE c.negocio_id = ? AND c.estado = 'activo'
            GROUP BY c.id
        `).all(negocio.id);

        const serviciosSinCategoria = db.prepare(`
            SELECT id, nombre, precio, duracion, descripcion
            FROM servicios WHERE negocio_id = ? AND categoria_id IS NULL AND estado = 'activo'
        `).all(negocio.id);

        res.json({ negocio, categorias, serviciosSinCategoria });
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.get('/availability/:slug', (req, res) => {
    try {
        const db = getDb();
        const { fecha, servicio_id } = req.query;
        
        const negocio = db.prepare(`
            SELECT id, hora_apertura, hora_cierre, dias_laborales, permitir_solapamiento
            FROM negocios WHERE slug = ? AND estado = 'activo' AND booking_activo = 1
        `).get(req.params.slug);

        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const servicio = db.prepare(`SELECT duracion FROM servicios WHERE id = ? AND negocio_id = ?`)
            .get(servicio_id, negocio.id);

        if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });

        const fechaDate = new Date(fecha + 'T12:00:00');
        let diaSemana = fechaDate.getDay();
        if (diaSemana === 0) diaSemana = 7;
        
        if (!negocio.dias_laborales.includes(diaSemana.toString())) {
            return res.json({ horarios: [], mensaje: 'No atienden este día' });
        }

        const citas = db.prepare(`
            SELECT hora_inicio, hora_fin FROM citas
            WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
        `).all(negocio.id, fecha);

        const [apH, apM] = negocio.hora_apertura.split(':').map(Number);
        const [ciH, ciM] = negocio.hora_cierre.split(':').map(Number);
        const aperturaMin = apH * 60 + apM;
        const cierreMin = ciH * 60 + ciM;
        const duracion = servicio.duracion;

        const ahora = new Date();
        const esHoy = fecha === ahora.toISOString().split('T')[0];
        const horaActualMin = esHoy ? (ahora.getHours() * 60 + ahora.getMinutes()) : null;

        const horarios = [];
        let actual = aperturaMin;

        while (actual + duracion <= cierreMin) {
            if (horaActualMin && actual <= horaActualMin) {
                actual += 30;
                continue;
            }

            const h = `${Math.floor(actual/60).toString().padStart(2,'0')}:${(actual%60).toString().padStart(2,'0')}`;
            const finMin = actual + duracion;
            const hf = `${Math.floor(finMin/60).toString().padStart(2,'0')}:${(finMin%60).toString().padStart(2,'0')}`;

            let disponible = true;
            for (const c of citas) {
                const [cH, cM] = c.hora_inicio.split(':').map(Number);
                const [cfH, cfM] = c.hora_fin.split(':').map(Number);
                const cInicio = cH * 60 + cM;
                const cFin = cfH * 60 + cfM;
                if (!(finMin <= cInicio || actual >= cFin)) {
                    disponible = false;
                    break;
                }
            }

            if (disponible) horarios.push({ hora: h, horaFin: hf });
            actual += 30;
        }

        res.json({ horarios });
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.post('/appointments', (req, res) => {
    try {
        const db = getDb();
        const { slug, servicio_id, fecha, hora, nombre, whatsapp, email, notas } = req.body;

        if (!slug || !servicio_id || !fecha || !hora || !nombre || !whatsapp) {
            return res.status(400).json({ error: 'Campos requeridos faltantes' });
        }

        const negocio = db.prepare(`SELECT id FROM negocios WHERE slug = ? AND estado = 'activo'`).get(slug);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const servicio = db.prepare(`SELECT duracion, nombre, precio FROM servicios WHERE id = ? AND negocio_id = ?`)
            .get(servicio_id, negocio.id);
        if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });

        const [h, m] = hora.split(':').map(Number);
        const finMin = h * 60 + m + servicio.duracion;
        const horaFin = `${Math.floor(finMin/60).toString().padStart(2,'0')}:${(finMin%60).toString().padStart(2,'0')}`;

        const conflict = db.prepare(`
            SELECT id FROM citas WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
            AND ((hora_inicio < ? AND hora_fin > ?) OR (hora_inicio < ? AND hora_fin > ?))
        `).get(negocio.id, fecha, horaFin, hora, horaFin, hora);

        if (conflict) return res.status(409).json({ error: 'Horario no disponible' });

        let cliente = db.prepare(`SELECT id FROM clientes WHERE negocio_id = ? AND telefono = ?`)
            .get(negocio.id, whatsapp);
        
        if (!cliente) {
            const result = db.prepare(`INSERT INTO clientes (negocio_id, nombre, telefono, email) VALUES (?, ?, ?, ?)`)
                .run(negocio.id, nombre, whatsapp, email || null);
            cliente = { id: result.lastInsertRowid };
        }

        // Obtener usuario admin del negocio para asignar user_id (SQLite no permite NULL en user_id)
        const usuarioDefault = db.prepare(`SELECT id FROM usuarios WHERE negocio_id = ? ORDER BY id ASC LIMIT 1`)
            .get(negocio.id);
        const userId = usuarioDefault ? usuarioDefault.id : 1;

        const result = db.prepare(`
            INSERT INTO citas (negocio_id, cliente_id, servicio_id, user_id, fecha, hora_inicio, hora_fin, estado, origen, notas)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', 'web', ?)
        `).run(negocio.id, cliente.id, servicio_id, userId, fecha, hora, horaFin, notas || null);

        db.prepare(`INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id) VALUES (?, 'cita', ?, ?)`)
            .run(negocio.id, `Nueva cita web: ${nombre} - ${servicio.nombre}`, result.lastInsertRowid);

        res.status(201).json({
            success: true,
            mensaje: '¡Cita agendada!',
            cita: {
                id: result.lastInsertRowid,
                fecha, hora_inicio: hora, hora_fin: horaFin,
                servicio: servicio.nombre, precio: servicio.precio
            }
        });
    } catch (error) {
        console.error('Error crear cita publica:', error);
        res.status(500).json({ error: 'Error al crear cita: ' + error.message });
    }
});

module.exports = router;
