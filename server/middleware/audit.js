/**
 * Middleware de auditoria — registra automaticamente acciones en log_auditoria
 */

function logAudit(accion, tabla) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = function(data) {
            try {
                const db = require('../database').getDb();
                const registroId = data && data.id ? data.id : null;
                const detalle = data && data.message ? data.message : null;

                db.prepare(`
                    INSERT INTO log_auditoria (negocio_id, user_id, accion, tabla, registro_id, detalle, ip, user_agent)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    req.session.negocioId,
                    req.session.userId,
                    accion,
                    tabla,
                    registroId,
                    detalle,
                    req.ip,
                    req.headers['user-agent']
                );
            } catch (e) {
                // No bloquear la respuesta si falla el log
                console.error('Error en log de auditoria:', e.message);
            }
            return originalJson(data);
        };
        next();
    };
}

module.exports = { logAudit };
