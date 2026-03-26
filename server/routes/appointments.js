const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
        fechaObj: ahoraLocal
    };
}

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const { fecha, fechaDesde, fechaHasta, estado } = req.query;

        let query = `
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.hora_fin, cit.estado, cit.notas,
                   c.id as cliente_id, c.nombre as cliente, c.telefono as cliente_telefono,
                   s.id as servicio_id, s.nombre as servicio, u.nombre as usuario
            FROM citas cit
            JOIN clientes c ON cit.cliente_id = c.id
            JOIN servicios s ON cit.servicio_id = s.id
            JOIN usuarios u ON cit.user_id = u.id
            WHERE cit.negocio_id = ?
        `;
        const params = [req.session.negocioId];

        if (fecha) {
            query += ' AND cit.fecha = ?';
            params.push(fecha);
        }

        if (fechaDesde && fechaHasta) {
            query += ' AND cit.fecha >= ? AND cit.fecha <= ?';
            params.push(fechaDesde, fechaHasta);
        } else if (fechaDesde) {
            query += ' AND cit.fecha >= ?';
            params.push(fechaDesde);
        } else if (fechaHasta) {
            query += ' AND cit.fecha <= ?';
            params.push(fechaHasta);
        }

        if (estado) {
            query += ' AND cit.estado = ?';
            params.push(estado);
        }

        query += ' ORDER BY cit.fecha ASC, cit.hora_inicio ASC';

        const citas = db.prepare(query).all(...params);
        res.json(citas);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener citas' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const cita = db.prepare(`
            SELECT cit.id, cit.negocio_id, cit.fecha, cit.hora_inicio, cit.hora_fin, 
                   cit.estado, cit.notas, cit.cliente_id, cit.servicio_id,
                   c.nombre as cliente, c.telefono as cliente_telefono, 
                   s.nombre as servicio, s.duracion, s.precio
            FROM citas cit
            JOIN clientes c ON cit.cliente_id = c.id
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.id = ? AND cit.negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!cita) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        res.json(cita);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener cita' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const { cliente_id, servicio_id, fecha, hora, notas } = req.body;

        // Validar campos requeridos
        if (!cliente_id || !servicio_id || !fecha || !hora) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        const db = getDb();

        // Obtener información del servicio
        const servicio = db.prepare('SELECT duracion FROM servicios WHERE id = ? AND negocio_id = ? AND estado = ?')
            .get(servicio_id, req.session.negocioId, 'activo');
        if (!servicio) {
            return res.status(400).json({ error: 'Servicio no válido' });
        }

        // Obtener información del cliente
        const cliente = db.prepare('SELECT id FROM clientes WHERE id = ? AND negocio_id = ?')
            .get(cliente_id, req.session.negocioId);
        if (!cliente) {
            return res.status(400).json({ error: 'Cliente no válido' });
        }

        // Obtener configuración del negocio (horario de operación)
        const config = db.prepare(`
            SELECT hora_apertura, hora_cierre, dias_laborales, permitir_solapamiento, 
                   buffer_entre_citas, zona_horaria, duracion_minima_cita, tiempo_anticipacion 
            FROM negocios WHERE id = ?
        `).get(req.session.negocioId);

        const bufferMin = config.buffer_entre_citas || 0;
        const zonaHoraria = config.zona_horaria || -4;
        const duracionMinima = config.duracion_minima_cita || 30;
        const tiempoAnticipacion = config.tiempo_anticipacion || 0;

        // Convertir horarios a minutos para comparación en formato 24h
        const [horaInt, horaMin] = hora.split(':').map(Number);
        const [aperturaH, aperturaM] = config.hora_apertura.split(':').map(Number);
        const [cierreH, cierreM] = config.hora_cierre.split(':').map(Number);

        const inicioMin = horaInt * 60 + horaMin;
        const aperturaMin = aperturaH * 60 + aperturaM;
        const cierreMin = cierreH * 60 + cierreM;
        const duracionMin = servicio.duracion;
        const finMin = inicioMin + duracionMin;

        // REGLA 0: Validar duración mínima del servicio
        if (duracionMin < duracionMinima) {
            return res.status(400).json({ error: `El servicio debe durar al menos ${duracionMinima} minutos` });
        }

        // REGLA 1: Validar que la cita INICIE dentro del horario del negocio
        if (inicioMin < aperturaMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio abre a las ${config.hora_apertura}` });
        }

        // Permitir que la cita inicie antes del cierre, aunque termine después
        if (inicioMin >= cierreMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio cierra a las ${config.hora_cierre}` });
        }

        // Calcular hora de fin de la cita
        const horaFin = `${Math.floor(finMin / 60).toString().padStart(2, '0')}:${(finMin % 60).toString().padStart(2, '0')}`;

        // REGLA 2: Validar que la fecha/hora no sea pasada (usando zona horaria del negocio)
        // Convertir la hora de la cita a UTC para comparar
        const [y, m, d] = fecha.split('-').map(Number);
        const [hh, mm] = hora.split(':').map(Number);
        
        // 14:10 en RD (UTC-4) = 18:10 UTC
        const fechaCitaUTC = Date.UTC(y, m - 1, d, hh, mm) - (zonaHoraria * 60 * 60 * 1000);
        const ahoraUTC = Date.now();
        
        if (fechaCitaUTC < ahoraUTC) {
            return res.status(400).json({ error: 'No se pueden crear citas en fechas u horas pasadas' });
        }

        // REGLA 2.1: Validar tiempo de anticipación
        if (tiempoAnticipacion > 0) {
            const milisegundosAnticipacion = tiempoAnticipacion * 60 * 1000;
            if (fechaCitaUTC < ahoraUTC + milisegundosAnticipacion) {
                return res.status(400).json({ error: `Debe agendar con al menos ${tiempoAnticipacion} minutos de anticipación` });
            }
        }

        // REGLA 3: Validar que no haya conflictos con otras citas
        if (config.permitir_solapamiento == 0) {
            // Calcular rangos con buffer para detección de conflictos
            const inicioConBuffer = Math.max(0, inicioMin - bufferMin);
            const finConBuffer = finMin + bufferMin;
            
            const horaInicioBuffer = `${Math.floor(inicioConBuffer / 60).toString().padStart(2, '0')}:${(inicioConBuffer % 60).toString().padStart(2, '0')}`;
            const horaFinBuffer = `${Math.floor(finConBuffer / 60).toString().padStart(2, '0')}:${(finConBuffer % 60).toString().padStart(2, '0')}`;

            // Verificar si existe conflicto con citas activas (pendiente, confirmada, finalizada)
            // Las citas canceladas NO bloquean el horario
            const conflict = db.prepare(`
                SELECT id FROM citas
                WHERE negocio_id = ? AND fecha = ? 
                AND estado NOT IN ('cancelada')
                AND (
                    (hora_inicio < ? AND hora_fin > ?) OR
                    (hora_inicio < ? AND hora_fin > ?) OR
                    (hora_inicio >= ? AND hora_fin <= ?)
                )
            `).get(req.session.negocioId, fecha, horaFinBuffer, horaInicioBuffer, horaFinBuffer, hora, horaInicioBuffer, horaFinBuffer);

            if (conflict) {
                return res.status(400).json({ error: 'Este horario ya ha sido reservado por otro cliente' });
            }
        }

        const result = db.prepare(`
            INSERT INTO citas (negocio_id, cliente_id, servicio_id, user_id, fecha, hora_inicio, hora_fin, notas, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')
        `).run(
            req.session.negocioId,
            cliente_id,
            servicio_id,
            req.session.userId,
            fecha,
            hora,
            horaFin,
            notas || null
        );

        db.prepare(`
            INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
            VALUES (?, 'cita', ?, ?)
        `).run(req.session.negocioId, `Nueva cita programada`, result.lastInsertRowid);

        const cita = db.prepare(`
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.hora_fin, cit.estado,
                   c.nombre as cliente, s.nombre as servicio
            FROM citas cit
            JOIN clientes c ON cit.cliente_id = c.id
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.id = ?
        `).get(result.lastInsertRowid);

        res.json(cita);
    } catch (error) {
        console.error('Error al crear cita:', error);
        res.status(500).json({ error: 'Error al crear la cita' });
    }
});

router.put('/:id', requireAuth, (req, res) => {
    try {
        const { cliente_id, servicio_id, fecha, hora, estado, notas } = req.body;
        const citaId = req.params.id;

        const db = getDb();

        const cita = db.prepare('SELECT id, servicio_id, fecha, hora_inicio, hora_fin FROM citas WHERE id = ? AND negocio_id = ?')
            .get(citaId, req.session.negocioId);

        if (!cita) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        const updates = [];
        const values = [];

        // Determinar si se está cambiando fecha u hora
        const nuevaFecha = fecha || cita.fecha;
        const nuevaHora = hora || cita.hora_inicio;
        const cambiandoHorario = fecha || hora;

        if (cliente_id) {
            const cliente = db.prepare('SELECT id FROM clientes WHERE id = ? AND negocio_id = ?')
                .get(cliente_id, req.session.negocioId);
            if (!cliente) {
                return res.status(400).json({ error: 'Cliente no válido' });
            }
            updates.push('cliente_id = ?');
            values.push(cliente_id);
        }
        
        let servicioDuracion = null;
        if (servicio_id) {
            const servicio = db.prepare('SELECT id, duracion FROM servicios WHERE id = ? AND negocio_id = ? AND estado = ?')
                .get(servicio_id, req.session.negocioId, 'activo');
            if (!servicio) {
                return res.status(400).json({ error: 'Servicio no válido' });
            }
            updates.push('servicio_id = ?');
            values.push(servicio_id);
            servicioDuracion = servicio.duracion;
        }
        
        if (fecha) {
            updates.push('fecha = ?');
            values.push(fecha);
        }
        
        if (hora) {
            updates.push('hora_inicio = ?');
            values.push(hora);
            
            if (!servicioDuracion) {
                const servicioOriginal = db.prepare('SELECT duracion FROM servicios WHERE id = ?')
                    .get(cita.servicio_id);
                servicioDuracion = servicioOriginal?.duracion || 30;
            }
            
            const [h, m] = hora.split(':').map(Number);
            const inicioMin = h * 60 + m;
            const finMin = inicioMin + servicioDuracion;
            const finH = Math.floor(finMin / 60);
            const finM = finMin % 60;
            const horaFin = `${finH.toString().padStart(2, '0')}:${finM.toString().padStart(2, '0')}`;
            
            updates.push('hora_fin = ?');
            values.push(horaFin);
        }
        
        if (estado && ['pendiente', 'confirmada', 'en_proceso', 'finalizada', 'cancelada'].includes(estado)) {
            updates.push('estado = ?');
            values.push(estado);
        }
        if (notas !== undefined) {
            updates.push('notas = ?');
            values.push(notas || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        // Validar fecha/hora no sea pasada si se está cambiando el horario (usando hora local)
        if (cambiandoHorario) {
            const ahora = new Date();
            const [y, m, d] = nuevaFecha.split('-').map(Number);
            const [hh, mm] = nuevaHora.split(':').map(Number);
            const fechaCitaLocal = new Date(y, m - 1, d, hh, mm);
            
            if (fechaCitaLocal < ahora) {
                return res.status(400).json({ error: 'No se pueden agendar citas en fechas u horas pasadas' });
            }
        }

        // Validar solapamiento si se está cambiando fecha, hora o servicio
        if (cambiandoHorario || servicio_id) {
            const config = db.prepare('SELECT permitir_solapamiento, buffer_entre_citas FROM negocios WHERE id = ?')
                .get(req.session.negocioId);
            const bufferMin = config.buffer_entre_citas || 0;

            if (config.permitir_solapamiento == 0) {
                // Calcular hora inicio y fin efectivas
                const [h, m] = nuevaHora.split(':').map(Number);
                const inicioMin = h * 60 + m;
                const duracion = servicioDuracion || (() => {
                    const s = db.prepare('SELECT duracion FROM servicios WHERE id = ?').get(cita.servicio_id);
                    return s?.duracion || 30;
                })();
                const finMin = inicioMin + duracion;
                const horaFin = `${Math.floor(finMin / 60).toString().padStart(2, '0')}:${(finMin % 60).toString().padStart(2, '0')}`;

                // Aplicar buffer
                const inicioConBuffer = Math.max(0, inicioMin - bufferMin);
                const finConBuffer = finMin + bufferMin;
                const horaInicioBuffer = `${Math.floor(inicioConBuffer / 60).toString().padStart(2, '0')}:${(inicioConBuffer % 60).toString().padStart(2, '0')}`;
                const horaFinBuffer = `${Math.floor(finConBuffer / 60).toString().padStart(2, '0')}:${(finConBuffer % 60).toString().padStart(2, '0')}`;

                const conflict = db.prepare(`
                    SELECT id FROM citas
                    WHERE negocio_id = ? AND fecha = ? AND id != ?
                    AND estado NOT IN ('cancelada')
                    AND (
                        (hora_inicio < ? AND hora_fin > ?) OR
                        (hora_inicio < ? AND hora_fin > ?) OR
                        (hora_inicio >= ? AND hora_fin <= ?)
                    )
                `).get(req.session.negocioId, nuevaFecha, citaId, horaFinBuffer, horaInicioBuffer, horaFinBuffer, nuevaHora, horaInicioBuffer, horaFinBuffer);

                if (conflict) {
                    return res.status(400).json({ error: 'Ya existe una cita en ese horario. Selecciona otro horario disponible.' });
                }
            }
        }

        values.push(citaId);
        db.prepare(`UPDATE citas SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare(`
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.hora_fin, cit.estado, cit.notas,
                   c.nombre as cliente, s.nombre as servicio
            FROM citas cit
            JOIN clientes c ON cit.cliente_id = c.id
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.id = ?
        `).get(citaId);

        res.json(updated);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar cita' });
    }
});

router.get('/horarios/disponibles', requireAuth, (req, res) => {
    try {
        const { fecha, servicio_id } = req.query;

        if (!fecha || !servicio_id) {
            return res.status(400).json({ error: 'Fecha y servicio son requeridos' });
        }

        const db = getDb();

        const servicio = db.prepare('SELECT nombre, duracion FROM servicios WHERE id = ? AND negocio_id = ?')
            .get(servicio_id, req.session.negocioId);

        if (!servicio) {
            return res.status(400).json({ error: 'Servicio no válido' });
        }

        const config = db.prepare('SELECT hora_apertura, hora_cierre, dias_laborales, buffer_entre_citas FROM negocios WHERE id = ?')
            .get(req.session.negocioId);

        const [year, month, day] = fecha.split('-').map(Number);
        const fechaDate = new Date(year, month - 1, day);
        let diaSemana = fechaDate.getDay();
        
        if (diaSemana === 0) diaSemana = 7;
        
        if (!config.dias_laborales.includes(diaSemana.toString())) {
            return res.json({ 
                horarios: [], 
                mensaje: 'El negocio no atiende este día',
                horario: `${config.hora_apertura} - ${config.hora_cierre}`
            });
        }

        const citas = db.prepare(`
            SELECT hora_inicio, hora_fin FROM citas
            WHERE negocio_id = ? AND fecha = ? AND estado NOT IN ('cancelada')
            ORDER BY hora_inicio
        `).all(req.session.negocioId, fecha);

        const [aperturaH, aperturaM] = config.hora_apertura.split(':').map(Number);
        const [cierreH, cierreM] = config.hora_cierre.split(':').map(Number);

        const aperturaMin = aperturaH * 60 + aperturaM;
        const cierreMin = cierreH * 60 + cierreM;
        const duracion = servicio.duracion;
        const bufferMin = config.buffer_entre_citas || 0;

        // Usar zona horaria del negocio para determinar si es hoy
        const horaNegocio = getHoraNegocio(db, req.session.negocioId);
        const esFechaHoy = (
            horaNegocio.fechaObj.getFullYear() === year &&
            (horaNegocio.fechaObj.getMonth() + 1) === month &&
            horaNegocio.fechaObj.getDate() === day
        );
        const horaActualMin = esFechaHoy ? horaNegocio.horaMinutos : null;

        const horarios = [];
        let actual = aperturaMin;

        // Generar slots: permitir cita si INICIA antes del cierre (aunque termine después)
        while (actual < cierreMin) {
            // Para HOY: saltar horarios que terminarían antes o en el momento actual
            if (esFechaHoy && horaActualMin !== null && actual + duracion <= horaActualMin) {
                actual += 5;
                continue;
            }

            const horaSlot = `${Math.floor(actual / 60).toString().padStart(2, '0')}:${(actual % 60).toString().padStart(2, '0')}`;
            const finMin = actual + duracion;
            const horaFin = `${Math.floor(finMin / 60).toString().padStart(2, '0')}:${(finMin % 60).toString().padStart(2, '0')}`;

            // Verificar conflictos con citas existentes
            let disponible = true;
            for (const cita of citas) {
                const [cH, cM] = cita.hora_inicio.split(':').map(Number);
                const [cfH, cfM] = cita.hora_fin.split(':').map(Number);
                const citaInicio = cH * 60 + cM;
                const citaFin = cfH * 60 + cfM;

                // Aplicar buffer para detección de conflictos
                const inicioConBuffer = Math.max(0, actual - bufferMin);
                const finConBuffer = finMin + bufferMin;

                // Verificar solapamiento
                if (!(finConBuffer <= citaInicio || inicioConBuffer >= citaFin)) {
                    disponible = false;
                    break;
                }
            }

            if (disponible) {
                horarios.push(horaSlot);
            }

            // Avanzar al siguiente slot de 30 minutos
            actual += 5;
        }

        const ultimoHorario = horarios.length > 0 
            ? `${Math.floor((cierreMin - duracion) / 60).toString().padStart(2, '0')}:${((cierreMin - duracion) % 60).toString().padStart(2, '0')}`
            : null;

        res.json({ 
            horarios,
            mensaje: horarios.length === 0 ? 'No hay horarios disponibles para este servicio' : null,
            horario: `${config.hora_apertura} - ${config.hora_cierre}`,
            duracion: duracion,
            ultimoHorario: ultimoHorario,
            esFechaHoy: esFechaHoy,
            buffer: bufferMin
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener horarios' });
    }
});

router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const citaId = req.params.id;
        const db = getDb();

        const cita = db.prepare('SELECT id, estado FROM citas WHERE id = ? AND negocio_id = ?')
            .get(citaId, req.session.negocioId);

        if (!cita) {
            return res.status(404).json({ error: 'Cita no encontrada' });
        }

        // Si la cita ya está cancelada, eliminar permanentemente
        if (cita.estado === 'cancelada') {
            db.prepare('DELETE FROM citas WHERE id = ?').run(citaId);
            
            db.prepare(`
                INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
                VALUES (?, 'cita', ?, ?)
            `).run(req.session.negocioId, `Cita eliminada permanentemente`, citaId);
            
            return res.json({ success: true, message: 'Cita eliminada permanentemente' });
        }

        // Si la cita no está cancelada, cancelarla (soft delete)
        db.prepare('UPDATE citas SET estado = ? WHERE id = ?').run('cancelada', citaId);

        db.prepare(`
            INSERT INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
            VALUES (?, 'cita', ?, ?)
        `).run(req.session.negocioId, `Cita cancelada`, citaId);

        res.json({ success: true, message: 'Cita cancelada correctamente' });
    } catch (error) {
        console.error('Error al procesar cita:', error);
        res.status(500).json({ error: 'Error al procesar cita' });
    }
});

module.exports = router;
