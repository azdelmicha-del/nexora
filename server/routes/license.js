const express = require('express');
const router = express.Router();
const license = require('../license');
const { LICENSE_MASTER_KEY } = require('../config');
const { getRDDateString, getRDDate } = require('../utils/timezone');

function isAuthorized(req) {
    const masterKey = req.headers['x-master-key'];
    console.log('isAuthorized check:', { 
        hasMasterKey: !!masterKey, 
        hasSuperAdminId: !!req.session?.superAdminId,
        sessionId: req.session?.id,
        superAdminId: req.session?.superAdminId
    });
    return masterKey === LICENSE_MASTER_KEY || !!req.session?.superAdminId;
}

router.get('/status', (req, res) => {
    const negocioId = req.session.negocioId;
    const isLocal = license.isLocalInstallation();
    const status = license.isLicenseValid(negocioId);
    const plans = license.getPlans();
    let planName = 'Prueba';
    let licenseInfo = {};
    
    if (isLocal) {
        const info = license.getLicense();
        if (info && info.plan && plans[info.plan]) {
            planName = plans[info.plan].name;
        }
        licenseInfo = {
            installDate: info?.installDate,
            isPaid: info?.isPaid,
            plan: info?.plan,
            expirationDate: info?.expirationDate
        };
    } else {
        if (status.type !== 'trial') {
            planName = plans[status.type]?.name || status.type;
        }
    }
    
    res.json({
        valid: status.valid,
        type: status.type,
        daysRemaining: status.daysRemaining,
        trialDays: license.TRIAL_DAYS,
        planName: planName,
        plans: plans,
        message: status.message || null,
        isOwner: false,
        licenseType: isLocal ? 'local' : 'database',
        debug: {
            negocioId: negocioId,
            licenciaPlan: status.licenciaPlan,
            licenciaFechaInicio: status.licenciaFechaInicio,
            licenciaFechaExpiracion: status.licenciaFechaExpiracion
        },
        ...licenseInfo
    });
});

router.post('/start-trial', (req, res) => {
    const userEmail = req.session?.email;
    const negocioId = req.session?.negocioId;
    
    // Todos los usuarios pasan por validación de licencia
    
    const trialStartDate = license.recordTrialStart(negocioId);
    res.json({ success: true, trialStartDate });
});

router.post('/activate', (req, res) => {
    const { key, plan } = req.body;
    const negocioId = req.session?.negocioId;
    
    if (!key || !plan) {
        return res.status(400).json({ error: 'Clave y plan requeridos' });
    }
    
    if (plan === 'trial') {
        return res.status(400).json({ error: 'Plan inválido' });
    }
    
    const result = license.activateLicense(key, plan, negocioId);
    
    if (!result.success) {
        return res.status(400).json({ error: result.message });
    }
    
    res.json(result);
});

router.get('/plans', (req, res) => {
    res.json(license.getPlans());
});

router.use((req, res, next) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
});

router.get('/keys', (req, res) => {
    const keys = license.getValidKeys();
    res.json(keys);
});

router.post('/keys/generate', (req, res) => {
    const { count = 1, plan = 'monthly' } = req.body;
    
    if (!license.getPlans()[plan]) {
        return res.status(400).json({ error: 'Plan inválido' });
    }
    
    const keys = license.getValidKeys();
    const planInfo = license.getPlans()[plan];
    
    for (let i = 0; i < count; i++) {
        keys.push({
            key: license.generateLicenseKey(),
            plan: plan,
            planName: planInfo.name,
            planDays: planInfo.days,
            created: getRDDate().toISOString()
        });
    }
    
    license.saveValidKeys(keys);
    res.json({ success: true, keys });
});

router.delete('/keys/:key', (req, res) => {
    const { key } = req.params;
    const keys = license.getValidKeys();
    const keyIndex = keys.findIndex(k => k.key === key);
    
    if (keyIndex === -1) {
        return res.status(404).json({ error: 'Clave no encontrada' });
    }
    
    keys.splice(keyIndex, 1);
    license.saveValidKeys(keys);
    
    res.json({ success: true, message: 'Clave eliminada' });
});

router.get('/businesses', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const { buscar } = req.query;
    
    let query = `
        SELECT 
            n.id,
            n.nombre,
            n.telefono,
            n.email,
            n.licencia_plan,
            n.licencia_fecha_inicio,
            n.licencia_fecha_expiracion,
            n.licencia_hardware_id,
            n.estado,
            (SELECT COUNT(*) FROM usuarios u WHERE u.negocio_id = n.id) as total_usuarios,
            (SELECT COUNT(*) FROM clientes c WHERE c.negocio_id = n.id) as total_clientes,
            (SELECT COUNT(*) FROM servicios s WHERE s.negocio_id = n.id AND s.estado = 'activo') as total_servicios,
            (SELECT COALESCE(SUM(v.total), 0) FROM ventas v WHERE v.negocio_id = n.id) as total_ventas,
            (SELECT COUNT(*) FROM ventas v WHERE v.negocio_id = n.id AND DATE(v.fecha) = DATE('now')) as ventas_hoy,
            (SELECT MAX(v.fecha) FROM ventas v WHERE v.negocio_id = n.id) as ultima_actividad
        FROM negocios n
    `;
    
    let params = [];
    if (buscar) {
        query += ` WHERE n.nombre LIKE ? OR n.email LIKE ? OR n.telefono LIKE ?`;
        const term = `%${buscar}%`;
        params = [term, term, term];
    }
    
    query += ` ORDER BY n.id DESC`;
    
    const negocios = db.prepare(query).all(...params);
    
    res.json(negocios);
});

router.get('/businesses/:id', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(req.params.id);
    
    const negocio = db.prepare(`
        SELECT * FROM negocios WHERE id = ?
    `).get(negocioId);
    
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const usuarios = db.prepare(`
        SELECT id, nombre, email, rol, estado, fecha_creacion FROM usuarios WHERE negocio_id = ?
    `).all(negocioId);
    
    const ventasRecientes = db.prepare(`
        SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
        FROM ventas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.negocio_id = ?
        ORDER BY v.fecha DESC
        LIMIT 10
    `).all(negocioId);
    
    res.json({
        ...negocio,
        usuarios,
        ventasRecientes
    });
});

router.put('/businesses/:id/suspend', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(req.params.id);
    const { suspendido } = req.body;
    
    const negocio = db.prepare('SELECT id FROM negocios WHERE id = ?').get(negocioId);
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const nuevoEstado = suspendido ? 'suspendido' : 'activo';
    db.prepare('UPDATE negocios SET estado = ? WHERE id = ?').run(nuevoEstado, negocioId);
    
    res.json({ success: true, message: suspendido ? 'Negocio suspendido' : 'Negocio reactivado' });
});

router.delete('/businesses/:id', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(req.params.id);
    
    const negocio = db.prepare('SELECT id, nombre FROM negocios WHERE id = ?').get(negocioId);
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    // Soft delete - cambiar estado a eliminado
    db.prepare('UPDATE negocios SET estado = ? WHERE id = ?').run('eliminado', negocioId);
    
    // Desactivar todos los usuarios del negocio
    db.prepare('UPDATE usuarios SET estado = ? WHERE negocio_id = ?').run('inactivo', negocioId);
    
    res.json({ success: true, message: `Negocio "${negocio.nombre}" eliminado (soft delete)` });
});

router.post('/businesses/:id/renew', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const { plan, dias } = req.body;
    const negocioId = parseInt(req.params.id);
    
    if (!plan || !dias) {
        return res.status(400).json({ error: 'Plan y días requeridos' });
    }
    
    const db = require('../database').getDb();
    const negocio = db.prepare('SELECT id FROM negocios WHERE id = ?').get(negocioId);
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const hoy = getRDDateString();
    const expiracion = getRDDate();
    expiracion.setDate(expiracion.getDate() + parseInt(dias));
    const fechaExpiracion = getRDDateString(expiracion);
    
    db.prepare(`
        UPDATE negocios 
        SET licencia_plan = ?, 
            licencia_fecha_inicio = ?, 
            licencia_fecha_expiracion = ?,
            estado = 'activo'
        WHERE id = ?
    `).run(plan, hoy, fechaExpiracion, negocioId);
    
    res.json({ 
        success: true, 
        message: `Licencia renovada: ${plan} (${dias} días)`,
        fechaExpiracion 
    });
});

router.get('/businesses/stats/growth', (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    
    const ultimosMeses = db.prepare(`
        SELECT 
            strftime('%Y-%m', fecha_creacion) as mes,
            COUNT(*) as cantidad
        FROM negocios
        WHERE fecha_creacion >= DATE('now', '-12 months')
        GROUP BY strftime('%Y-%m', fecha_creacion)
        ORDER BY mes ASC
    `).all();
    
    const resumen = db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN licencia_plan != 'trial' AND licencia_plan IS NOT NULL THEN 1 ELSE 0 END) as activos,
            SUM(CASE WHEN licencia_plan = 'trial' OR licencia_plan IS NULL THEN 1 ELSE 0 END) as en_trial,
            SUM(CASE WHEN estado = 'suspendido' THEN 1 ELSE 0 END) as suspendidos
        FROM negocios
        WHERE estado != 'eliminado'
    `).get();
    
    res.json({
        mensual: ultimosMeses,
        resumen
    });
});

module.exports = router;
