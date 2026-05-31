const express = require('express');
const mongoose = require('mongoose');
const { getDb, toPlainId } = require('../database');
const { upsertCanonicalClient } = require('../utils/client-canonical');
const { getRDDate, getRDDateString } = require('../utils/timezone');
const router = express.Router();

function isClientValidationError(message) {
    if (!message) return false;
    return /requerido|telefono|celular|email|documento|tipo_documento/i.test(message);
}

function getRDNowInfo() {
    const ahoraRD = getRDDate();
    return {
        fecha: getRDDateString(ahoraRD),
        hora: ahoraRD.getHours(),
        minuto: ahoraRD.getMinutes(),
        horaMinutos: ahoraRD.getHours() * 60 + ahoraRD.getMinutes(),
        fechaObj: ahoraRD
    };
}

router.get('/business/:slug', async (req, res) => {
    try {
        const db = getDb();
        const negocioRaw = await db.collection('negocios').findOne({ slug: req.params.slug, estado: 'activo' });

        if (!negocioRaw || !negocioRaw.booking_activo) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        const negocio = toPlainId(negocioRaw);

        const categorias = await db.collection('categorias').aggregate([
            { $match: { negocio_id: negocioRaw._id, estado: 'activo' } },
            {
                $lookup: {
                    from: 'servicios',
                    let: { catId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: [{ $toString: '$categoria_id' }, { $toString: '$$catId' }] },
                                        { $eq: ['$estado', 'activo'] }
                                    ]
                                }
                            }
                        },
                        { $project: { _id: 0, id: { $toString: '$_id' }, nombre: 1, precio: 1, duracion: 1, descripcion: 1, imagen: 1 } }
                    ],
                    as: 'servicios'
                }
            },
            { $project: { _id: 0, id: { $toString: '$_id' }, nombre: 1, servicios: 1 } }
        ]).toArray();

        const serviciosRaw = await db.collection('servicios').find(
            { negocio_id: negocioRaw._id, categoria_id: null, estado: 'activo' }
        ).toArray();
        const serviciosSinCategoria = serviciosRaw.map(s => ({
            id: s._id.toString(),
            nombre: s.nombre,
            precio: s.precio,
            duracion: s.duracion,
            descripcion: s.descripcion,
            imagen: s.imagen
        }));

        res.json({ negocio, categorias, serviciosSinCategoria });
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.get('/availability/:slug', async (req, res) => {
    try {
        const db = getDb();
        const { fecha, servicio_id } = req.query;

        const negocioRaw = await db.collection('negocios').findOne({ slug: req.params.slug, estado: 'activo' });

        if (!negocioRaw || !negocioRaw.booking_activo) return res.status(404).json({ error: 'Negocio no encontrado' });

        const servicio = await db.collection('servicios').findOne({
            _id: new mongoose.Types.ObjectId(servicio_id),
            negocio_id: negocioRaw._id
        });

        if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });

        const fechaDate = new Date(fecha + 'T12:00:00');
        let diaSemana = fechaDate.getDay();
        if (diaSemana === 0) diaSemana = 7;

        const diasLaboralesStr = negocioRaw.dias_laborales;
        if (!diasLaboralesStr.includes(diaSemana.toString())) {
            return res.json({ horarios: [], mensaje: 'No atienden este día' });
        }

        const citas = await db.collection('citas').find(
            { negocio_id: negocioRaw._id, fecha, estado: { $ne: 'cancelada' } }
        ).toArray();

        const [apH, apM] = negocioRaw.hora_apertura.split(':').map(Number);
        const [ciH, ciM] = negocioRaw.hora_cierre.split(':').map(Number);
        const aperturaMin = apH * 60 + apM;
        const cierreMin = ciH * 60 + ciM;
        const duracion = servicio.duracion;
        const bufferMin = negocioRaw.buffer_entre_citas || 0;

        const horaNegocio = getRDNowInfo();
        const esHoy = fecha === horaNegocio.fecha;
        const horaActualMin = esHoy ? horaNegocio.horaMinutos : null;
        const tiempoAnticipacion = negocioRaw.tiempo_anticipacion || 0;
        const minimoReservableMin = esHoy ? (horaNegocio.horaMinutos + tiempoAnticipacion) : null;

        const horarios = [];
        let actual = aperturaMin;

        while (actual < cierreMin) {
            if (horaActualMin !== null && actual < horaActualMin) {
                actual += 5;
                continue;
            }

            if (minimoReservableMin !== null && actual < minimoReservableMin) {
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

        if (!horarios.length && esHoy && minimoReservableMin !== null && minimoReservableMin >= cierreMin) {
            const diasLaborales = diasLaboralesStr.split(',').map(Number);
            const siguiente = new Date(fecha + 'T12:00:00');
            let fechaSugerida = null;

            for (let i = 1; i <= 60; i++) {
                const candidato = new Date(siguiente);
                candidato.setDate(siguiente.getDate() + i);
                let dia = candidato.getDay();
                if (dia === 0) dia = 7;
                if (diasLaborales.includes(dia)) {
                    const y = candidato.getFullYear();
                    const m = String(candidato.getMonth() + 1).padStart(2, '0');
                    const d = String(candidato.getDate()).padStart(2, '0');
                    fechaSugerida = `${y}-${m}-${d}`;
                    break;
                }
            }

            return res.json({
                horarios,
                bloqueadoPorAnticipacion: true,
                mensaje: `Por la anticipación mínima de ${tiempoAnticipacion} minutos, hoy ya no hay horarios disponibles.`,
                fechaSugerida
            });
        }

        res.json({ horarios });
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

router.post('/appointments', async (req, res) => {
    try {
        const db = getDb();
        const { slug, servicio_id, fecha, hora, nombre, whatsapp, email, notas, tipo_documento, documento } = req.body;

        if (!slug || !servicio_id || !fecha || !hora || !nombre || !whatsapp) {
            return res.status(400).json({ error: 'Campos requeridos faltantes' });
        }

        const negocioRaw = await db.collection('negocios').findOne({ slug, estado: 'activo' });
        if (!negocioRaw) return res.status(404).json({ error: 'Negocio no encontrado' });

        const servicioId = new mongoose.Types.ObjectId(servicio_id);
        const servicio = await db.collection('servicios').findOne({
            _id: servicioId,
            negocio_id: negocioRaw._id
        });
        if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado' });

        const duracionMinima = negocioRaw.duracion_minima_cita || 30;
        const tiempoAnticipacion = negocioRaw.tiempo_anticipacion || 0;

        if (servicio.duracion < duracionMinima) {
            return res.status(400).json({ error: `El servicio debe durar al menos ${duracionMinima} minutos` });
        }

        const [hh, mm] = hora.split(':').map(Number);
        const horaCitaMin = (hh * 60) + mm;
        const ahoraRD = getRDNowInfo();

        if (fecha < ahoraRD.fecha || (fecha === ahoraRD.fecha && horaCitaMin < ahoraRD.horaMinutos)) {
            return res.status(400).json({ error: 'No se pueden crear citas en fechas u horas pasadas' });
        }

        if (tiempoAnticipacion > 0) {
            if (fecha === ahoraRD.fecha && horaCitaMin < (ahoraRD.horaMinutos + tiempoAnticipacion)) {
                return res.status(400).json({ error: `Debe agendar con al menos ${tiempoAnticipacion} minutos de anticipación` });
            }
        }

        const [h, min] = hora.split(':').map(Number);
        const [aperturaH, aperturaM] = negocioRaw.hora_apertura.split(':').map(Number);
        const [cierreH, cierreM] = negocioRaw.hora_cierre.split(':').map(Number);

        const inicioMin = h * 60 + min;
        const aperturaMin = aperturaH * 60 + aperturaM;
        const cierreMin = cierreH * 60 + cierreM;
        const duracionMin = servicio.duracion;
        const finMin = inicioMin + duracionMin;

        if (inicioMin < aperturaMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio abre a las ${negocioRaw.hora_apertura}` });
        }

        if (inicioMin >= cierreMin) {
            return res.status(400).json({ error: `Horario fuera de servicio. El negocio cierra a las ${negocioRaw.hora_cierre}` });
        }

        const horaFin = `${Math.floor(finMin/60).toString().padStart(2,'0')}:${(finMin%60).toString().padStart(2,'0')}`;
        const bufferMin = negocioRaw.buffer_entre_citas || 0;

        const inicioConBuffer = Math.max(0, inicioMin - bufferMin);
        const finConBuffer = finMin + bufferMin;
        const horaInicioBuffer = `${Math.floor(inicioConBuffer / 60).toString().padStart(2, '0')}:${(inicioConBuffer % 60).toString().padStart(2, '0')}`;
        const horaFinBuffer = `${Math.floor(finConBuffer / 60).toString().padStart(2, '0')}:${(finConBuffer % 60).toString().padStart(2, '0')}`;

        const conflict = await db.collection('citas').findOne({
            negocio_id: negocioRaw._id,
            fecha,
            estado: { $ne: 'cancelada' },
            $or: [
                { hora_inicio: { $lt: horaFinBuffer }, hora_fin: { $gt: horaInicioBuffer } },
                { hora_inicio: { $lt: horaFinBuffer }, hora_fin: { $gt: hora } },
                { hora_inicio: { $gte: horaInicioBuffer }, hora_fin: { $lte: horaFinBuffer } }
            ]
        });

        if (conflict) return res.status(409).json({ error: 'Este horario ya ha sido reservado por otro cliente' });

        const cliente = await upsertCanonicalClient(
            db,
            negocioRaw._id,
            {
                nombre,
                telefono: whatsapp,
                email,
                notas,
                tipo_documento,
                documento
            },
            { requireName: true, requirePhone: true, createIfMissing: true, updateMissingFields: true }
        );

        const usuarioDefault = await db.collection('usuarios').findOne(
            { negocio_id: negocioRaw._id },
            { sort: { _id: 1 } }
        );
        const userId = usuarioDefault ? usuarioDefault._id : null;

        const citaResult = await db.collection('citas').insertOne({
            negocio_id: negocioRaw._id,
            cliente_id: new mongoose.Types.ObjectId(cliente.id),
            servicio_id: servicioId,
            user_id: userId,
            fecha,
            hora_inicio: hora,
            hora_fin: horaFin,
            estado: 'pendiente',
            origen: 'web',
            notas: notas || null
        });

        await db.collection('notificaciones').insertOne({
            negocio_id: negocioRaw._id,
            tipo: 'cita',
            mensaje: `Nueva cita web: ${nombre} - ${servicio.nombre}`,
            referencia_id: citaResult.insertedId
        });

        res.status(201).json({
            success: true,
            mensaje: '¡Cita agendada!',
            cita: {
                id: citaResult.insertedId.toString(),
                fecha,
                hora_inicio: hora,
                hora_fin: horaFin,
                servicio: servicio.nombre,
                precio: servicio.precio
            }
        });
    } catch (error) {
        console.error('Error crear cita publica:', error);
        if (isClientValidationError(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Error al crear cita: ' + error.message });
    }
});

module.exports = router;
