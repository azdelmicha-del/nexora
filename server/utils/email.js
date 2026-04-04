/**
 * Servicio de email para Nexora
 * Envía confirmaciones de citas, recordatorios y notificaciones
 */

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.EMAIL_PORT || '587');
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    const from = process.env.EMAIL_FROM || 'Nexora <no-reply@nexora.do>';

    if (!user || !pass) {
        console.warn('⚠️  EMAIL_USER o EMAIL_PASS no configurados — email deshabilitado');
        return null;
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });

    return transporter;
}

/**
 * Enviar email de confirmación de cita
 */
async function enviarConfirmacionCita({
    negocio,
    cliente,
    servicio,
    fecha,
    horaInicio,
    horaFin,
    barbero,
    total
}) {
    const t = getTransporter();
    if (!t) return { success: false, reason: 'email_no_configurado' };

    const fechaFmt = new Date(fecha).toLocaleDateString('es-DO', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    const horaFmt = `${horaInicio} - ${horaFin || ''}`;

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:2rem;text-align:center;color:#fff;">
            <h1 style="margin:0;font-size:1.5rem;">✓ Cita Confirmada</h1>
            <p style="margin:0.5rem 0 0;opacity:0.85;">${negocio?.nombre || 'Tu negocio'}</p>
        </div>
        <div style="padding:1.5rem;">
            <p style="color:#374151;font-size:1rem;">Hola <strong>${cliente}</strong>,</p>
            <p style="color:#6b7280;">Tu cita ha sido confirmada exitosamente:</p>
            <table style="width:100%;border-collapse:collapse;margin:1rem 0;">
                <tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:0.6rem 0;color:#6b7280;">📋 Servicio</td>
                    <td style="padding:0.6rem 0;text-align:right;font-weight:600;color:#1f2937;">${servicio}</td>
                </tr>
                <tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:0.6rem 0;color:#6b7280;">📅 Fecha</td>
                    <td style="padding:0.6rem 0;text-align:right;font-weight:600;color:#1f2937;">${fechaFmt}</td>
                </tr>
                <tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:0.6rem 0;color:#6b7280;">🕐 Horario</td>
                    <td style="padding:0.6rem 0;text-align:right;font-weight:600;color:#1f2937;">${horaFmt}</td>
                </tr>
                ${barbero ? `<tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:0.6rem 0;color:#6b7280;">💇 Profesional</td>
                    <td style="padding:0.6rem 0;text-align:right;font-weight:600;color:#1f2937;">${barbero}</td>
                </tr>` : ''}
                ${total ? `<tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:0.6rem 0;color:#6b7280;">💰 Total</td>
                    <td style="padding:0.6rem 0;text-align:right;font-weight:700;color:#10b981;font-size:1.1rem;">RD$${total.toFixed(2)}</td>
                </tr>` : ''}
            </table>
            <p style="color:#9ca3af;font-size:0.85rem;text-align:center;margin-top:1.5rem;">
                Powered by <strong>Nexora</strong> — Sistema de Gestión
            </p>
        </div>
    </div>`;

    try {
        await t.sendMail({
            from: process.env.EMAIL_FROM || 'Nexora <no-reply@nexora.do>',
            to: cliente,
            subject: `✓ Cita confirmada — ${servicio} | ${negocio?.nombre || 'Nexora'}`,
            html
        });
        return { success: true };
    } catch (err) {
        console.error('Error enviando email de cita:', err.message);
        return { success: false, reason: err.message };
    }
}

/**
 * Enviar recordatorio de cita (24h antes)
 */
async function enviarRecordatorioCita({ negocio, cliente, servicio, fecha, horaInicio }) {
    const t = getTransporter();
    if (!t) return { success: false, reason: 'email_no_configurado' };

    const fechaFmt = new Date(fecha).toLocaleDateString('es-DO', {
        weekday: 'long', day: '2-digit', month: 'long'
    });

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:2rem;text-align:center;color:#fff;">
            <h1 style="margin:0;font-size:1.5rem;">⏰ Recordatorio de Cita</h1>
            <p style="margin:0.5rem 0 0;opacity:0.85;">${negocio?.nombre || 'Tu negocio'}</p>
        </div>
        <div style="padding:1.5rem;">
            <p style="color:#374151;">Hola <strong>${cliente}</strong>,</p>
            <p style="color:#6b7280;">Te recordamos que tienes una cita mañana:</p>
            <div style="background:#fef3c7;border-radius:12px;padding:1rem;margin:1rem 0;">
                <p style="margin:0;font-weight:700;color:#92400e;">${servicio}</p>
                <p style="margin:0.25rem 0 0;color:#a16207;">📅 ${fechaFmt} a las ${horaInicio}</p>
            </div>
            <p style="color:#9ca3af;font-size:0.85rem;text-align:center;">Powered by <strong>Nexora</strong></p>
        </div>
    </div>`;

    try {
        await t.sendMail({
            from: process.env.EMAIL_FROM || 'Nexora <no-reply@nexora.do>',
            to: cliente,
            subject: `⏰ Recordatorio: ${servicio} mañana`,
            html
        });
        return { success: true };
    } catch (err) {
        console.error('Error enviando recordatorio:', err.message);
        return { success: false, reason: err.message };
    }
}

module.exports = {
    getTransporter,
    enviarConfirmacionCita,
    enviarRecordatorioCita
};
