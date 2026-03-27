const express = require('express');
const { getDb } = require('../database');
const router = express.Router();

// Función para obtener la hora actual en la zona horaria del negocio
function getHoraNegocio(db, negocioId) {
    const config = db.prepare('SELECT zona_horaria FROM negocios WHERE id = ?').get(negocioId);
    const zonaHoraria = config ? config.zona_horaria : -4; // Default: UTC-4 (República Dominicana)
    
    const ahoraUTC = new Date();
    const ahoraLocal = new Date(ahoraUTC.getTime() + (zonaHoraria * 60 * 60 * 1000));
    
    return {
        fecha: `${ahoraLocal.getFullYear()}-${String(ahoraLocal.getMonth() + 1).padStart(2, '0')}-${String(ahoraLocal.getDate()).padStart(2, '0')}`,
        hora: ahoraLocal.getHours(),
        minuto: ahoraLocal.getMinutes(),
        horaMinutos: ahoraLocal.getHours() * 60 + ahoraLocal.getMinutes(),
        fechaObj: ahoraLocal,
        zona_horaria: zonaHoraria
    };
}

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
                'duracion', s.duracion, 'descripcion', s.descripcion, 'imagen', s.imagen
            )) as servicios
            FROM categorias c
            LEFT JOIN servicios s ON s.categoria_id = c.id AND s.estado = 'activo'
            WHERE c.negocio_id = ? AND c.estado = 'activo'
            GROUP BY c.id
        `).all(negocio.id);

        const serviciosSinCategoria = db.prepare(`
            SELECT id, nombre, precio, duracion, descripcion, imagen
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
            SELECT id, hora_apertura, hora_cierre, dias_laborales, permitir_solapamiento, buffer_entre_citas
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
        const bufferMin = negocio.buffer_entre_citas || 0;

        // Usar zona horaria del negocio
        const horaNegocio = getHoraNegocio(db, negocio.id);
        const esHoy = fecha === horaNegocio.fecha;
        const horaActualMin = esHoy ? horaNegocio.horaMinutos : null;

        const horarios = [];
        let actual = aperturaMin;

        while (actual < cierreMin) {
            // Saltar horarios que terminarían antes o en el momento actual
            if (horaActualMin !== null && actual + duracion <= horaActualMin) {
                actual += 5;
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

                // Aplicar buffer
                const inicioConBuffer = Math.max(0, actual - bufferMin);
                const finConBuffer = finMin + bufferMin;

                if (!(finConBuffer <= cInicio || inicioConBuffer >= cFin)) {
                    disponible = false;
                    break;
                }
            }

            if (disponible) horarios.push({ hora: h, horaFin: hf });
            actual += 5;
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

        // Validar campos requeridos
        if (!slug || !servicio_id || !fecha || !hora || !nombre || !whatsapp) {
            return res.status(400).json({ error: 'Campos requeridos faltantes' });
        }

        // Obtener información del negocio (horario de operación)
        const negocio = db.prepare(`
            SELECT id, buffer_entre_citas, hora_apertura, hora_cierre, zona_horaria, duracion_minima_cita, tiempo_anticipacion 
            FROM negocios WHERE slug = ? AND estado = 'activo'
        `).get(slug);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        // Obtener información del servicio
        const servicio = db.prepare(`SELECT duracion, nombre, precio FROM servicios WHERE id = ? AND negocio_id = ?`)
            .get(servicio_id, negocio.id);
        if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });

        const zonaHoraria = negocio.zona_horaria || -4;
        const duracionMinima = negocio.duracion_minima_cita || 30;
        const tiempoAnticipacion = negocio.tiempo_anticipacion || 0;

        // Validar duración mínima del servicio
        if (servicio.duracion < duracionMinima) {
            return res.status(400).json({ error: `El servicio debe durar al menos ${duracionMinima} minutos` });
        }

        // REGLA 1: Validar que la fecha/hora no sea pasada (usando zona horaria del negocio)
        const [anio, mes, dia] = fecha.split('-').map(Number);
        const [hh, mm] = hora.split(':').map(Number);
        
        // 14:10 en RD (UTC-4) = 18:10 UTC
        const fechaCitaUTC = Date.UTC(anio, mes - 1, dia, hh, mm) - (zonaHoraria * 60 * 60 * 1000);
        const ahoraUTC = Date.now();
        
        if (fechaCitaUTC < ahoraUTC) {
            return res.status(400).json({ error: 'No se pueden crear citas en fechas u horas pasadas' });
        }

        // Validar tiempo de anticipación
        if (tiempoAnticipacion > 0) {
            const milisegundosAnticipacion = tiempoAnticipacion * 60 * 1000;
            if (fechaCitaUTC < ahoraUTC + milisegundosAnticipacion) {
                return res.status(400).json({ error: `Debe agendar con al menos ${tiempoAnticipacion} minutos de anticipación` });
            }
        }

        // REGLA 2: Validar que la cita esté dentro del horario del negocio
        const [h, min] = hora.split(':').map(Number);
        const [aperturaH, aperturaM] = negocio.hora_apertura.split(':').map(Number);
        const [cierreH, cierreM] = negocio.hora_cierre.split(':').map(Number);
        
        const inicioMin = h * 60 + min;
        const aperturaMin = aperturaH * 60 + aperturaM;
        const cierreMin = cierreH * 60 + cierreM;
        const duracionMin = servicio.duracion;
        const finMin = inicioMin + duracionMin;

        if (inicioMin < aperturaMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio abre a las ${negocio.hora_apertura}` });
        }

        // Permitir que la cita inicie antes del cierre, aunque termine después
        if (inicioMin >= cierreMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio cierra a las ${negocio.hora_cierre}` });
        }

        const horaFin = `${Math.floor(finMin/60).toString().padStart(2,'0')}:${(finMin%60).toString().padStart(2,'0')}`;
        const bufferMin = negocio.buffer_entre_citas || 0;

        // REGLA 3: Validar que no haya conflictos con otras citas
        const inicioConBuffer = Math.max(0, inicioMin - bufferMin);
        const finConBuffer = finMin + bufferMin;
        const horaInicioBuffer = `${Math.floor(inicioConBuffer / 60).toString().padStart(2, '0')}:${(inicioConBuffer % 60).toString().padStart(2, '0')}`;
        const horaFinBuffer = `${Math.floor(finConBuffer / 60).toString().padStart(2, '0')}:${(finConBuffer % 60).toString().padStart(2, '0')}`;

        const conflict = db.prepare(`
            SELECT id FROM citas 
            WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
            AND (
                (hora_inicio < ? AND hora_fin > ?) OR
                (hora_inicio < ? AND hora_fin > ?) OR
                (hora_inicio >= ? AND hora_fin <= ?)
            )
        `).get(negocio.id, fecha, horaFinBuffer, horaInicioBuffer, horaFinBuffer, hora, horaInicioBuffer, horaFinBuffer);

        if (conflict) return res.status(409).json({ error: 'Este horario ya ha sido reservado por otro cliente' });

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
