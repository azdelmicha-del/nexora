/**
 * Cron job para recordatorios de citas
 * Verifica citas proximas (24h antes) y envia recordatorios por email
 * Se ejecuta cada hora
 */

const { getDb } = require('../database');
const { enviarRecordatorioCita } = require('../utils/email');
const { getRDDateString, getRDDate } = require('../utils/timezone');

let cronInterval = null;

function iniciarRecordatoriosCitas() {
    if (cronInterval) {
        clearInterval(cronInterval);
    }

    // Ejecutar cada hora
    cronInterval = setInterval(async () => {
        try {
            await verificarYEnviarRecordatorios();
        } catch (error) {
            console.error('Error en cron de recordatorios:', error.message);
        }
    }, 60 * 60 * 1000); // 1 hora

    // Ejecutar inmediatamente al iniciar
    verificarYEnviarRecordatorios().catch(e => console.error('Error recordatorios iniciales:', e.message));
}

async function verificarYEnviarRecordatorios() {
    const db = getDb();
    const manana = getRDDate();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = getRDDateString(manana);

    // Citas de manana con email que no han sido recordadas
    const citas = db.prepare(`
        SELECT c.id, c.fecha, c.hora_inicio, c.estado,
               cl.nombre as cliente_nombre, cl.email as cliente_email,
               s.nombre as servicio_nombre,
               n.nombre as negocio_nombre
        FROM citas c
        JOIN clientes cl ON c.cliente_id = cl.id
        JOIN servicios s ON c.servicio_id = s.id
        JOIN negocios n ON c.negocio_id = n.id
        WHERE DATE(c.fecha) = ?
          AND c.estado = 'pendiente'
          AND cl.email IS NOT NULL
          AND cl.email != ''
          AND c.negocio_id IN (SELECT id FROM negocios WHERE notificaciones_activas = 1)
    `).all(mananaStr);

    if (citas.length === 0) return;

    console.log(`[Recordatorios] ${citas.length} citas pendientes para ${mananaStr}`);

    for (const cita of citas) {
        try {
            const resultado = await enviarRecordatorioCita({
                negocio: { nombre: cita.negocio_nombre },
                cliente: cita.cliente_email,
                servicio: cita.servicio_nombre,
                fecha: cita.fecha,
                horaInicio: cita.hora_inicio
            });

            if (resultado.success) {
                console.log(`[Recordatorio] Enviado a ${cita.cliente_email} para cita #${cita.id}`);
                // Marcar como recordada para no duplicar
                db.prepare(`
                    INSERT OR IGNORE INTO notificaciones (negocio_id, tipo, mensaje, referencia_id)
                    VALUES (?, 'recordatorio_cita', ?, ?)
                `).run(cita.negocio_id, `Recordatorio enviado a ${cita.cliente_email}`, cita.id);
            }
        } catch (error) {
            console.error(`[Recordatorio] Error enviando a ${cita.cliente_email}:`, error.message);
        }
    }
}

function detenerRecordatoriosCitas() {
    if (cronInterval) {
        clearInterval(cronInterval);
        cronInterval = null;
    }
}

module.exports = { iniciarRecordatoriosCitas, detenerRecordatoriosCitas };
