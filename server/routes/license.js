const express = require('express');
const router = express.Router();
const license = require('../license');
const { LICENSE_MASTER_KEY } = require('../config');
const { getRDDateString, getRDDate } = require('../utils/timezone');
const { normalizeId } = require('../database');

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

router.get('/status', async (req, res) => {
    try {
        const negocioId = normalizeId(req.session.negocioId);
        const status = await license.isLicenseValid(negocioId);
        const plans = license.getPlans();
        let planName = 'Prueba';
        if (status.type !== 'trial') {
            planName = plans[status.type]?.name || status.type;
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
            licenseType: 'database',
            debug: {
                negocioId: negocioId,
                licenciaPlan: status.licenciaPlan,
                licenciaFechaInicio: status.licenciaFechaInicio,
                licenciaFechaExpiracion: status.licenciaFechaExpiracion
            },
            plan: status.type,
            expirationDate: status.licenciaFechaExpiracion,
            isPaid: status.type !== 'trial',
            installDate: status.licenciaFechaInicio
        });
    } catch (error) {
        console.error('Error /api/license/status:', error);
        res.json({
            valid: true,
            type: 'trial',
            daysRemaining: 7,
            trialDays: 7,
            planName: 'Prueba',
            plans: license.getPlans(),
            message: null,
            isOwner: false,
            licenseType: 'database',
            plan: 'trial',
            expirationDate: null,
            isPaid: false,
            installDate: null
        });
    }
});

router.post('/start-trial', (req, res) => {
    const userEmail = req.session?.email;
    const negocioId = req.session?.negocioId;
    
    const trialStartDate = license.recordTrialStart(negocioId);
    res.json({ success: true, trialStartDate });
});

router.post('/activate', async (req, res) => {
    const { key, plan } = req.body;
    const negocioId = req.session?.negocioId;

    if (!key || !plan) {
        return res.status(400).json({ error: 'Clave y plan requeridos' });
    }

    if (plan === 'trial') {
        return res.status(400).json({ error: 'Plan inválido' });
    }

    const result = await license.activateLicense(key, plan, negocioId);

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

router.get('/businesses', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const { buscar } = req.query;
    
    let matchStage = {};
    if (buscar) {
        const term = new RegExp(buscar, 'i');
        matchStage = {
            $or: [
                { nombre: term },
                { email: term },
                { telefono: term }
            ]
        };
    }
    
    const negocios = await db.collection('negocios').aggregate([
        ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
        {
            $lookup: {
                from: 'usuarios',
                let: { negocioId: '$id' },
                pipeline: [{ $match: { $expr: { $eq: ['$negocio_id', '$$negocioId'] } } }],
                as: 'usuarios'
            }
        },
        {
            $lookup: {
                from: 'clientes',
                let: { negocioId: '$id' },
                pipeline: [{ $match: { $expr: { $eq: ['$negocio_id', '$$negocioId'] } } }],
                as: 'clientes'
            }
        },
        {
            $lookup: {
                from: 'servicios',
                let: { negocioId: '$id' },
                pipeline: [{ $match: { $expr: { $eq: ['$negocio_id', '$$negocioId'] }, estado: 'activo' } }],
                as: 'servicios'
            }
        },
        {
            $lookup: {
                from: 'ventas',
                let: { negocioId: '$id' },
                pipeline: [{ $match: { $expr: { $eq: ['$negocio_id', '$$negocioId'] } } }],
                as: 'ventas'
            }
        },
        {
            $addFields: {
                total_usuarios: { $size: '$usuarios' },
                total_clientes: { $size: '$clientes' },
                total_servicios: { $size: '$servicios' },
                total_ventas: { $sum: '$ventas.total' },
                ventas_hoy: {
                    $size: {
                        $filter: {
                            input: '$ventas',
                            as: 'v',
                            cond: {
                                $eq: [
                                    { $dateToString: { format: '%Y-%m-%d', date: '$$v.fecha' } },
                                    { $dateToString: { format: '%Y-%m-%d', date: new Date() } }
                                ]
                            }
                        }
                    }
                },
                ultima_actividad: { $max: '$ventas.fecha' }
            }
        },
        {
            $project: {
                usuarios: 0,
                clientes: 0,
                servicios: 0,
                ventas: 0
            }
        },
        { $sort: { id: -1 } }
    ]).toArray();
    
    const result = negocios.map(n => ({
        id: n.id,
        nombre: n.nombre,
        telefono: n.telefono,
        email: n.email,
        licencia_plan: n.licencia_plan,
        licencia_fecha_inicio: n.licencia_fecha_inicio,
        licencia_fecha_expiracion: n.licencia_fecha_expiracion,
        licencia_hardware_id: n.licencia_hardware_id,
        estado: n.estado,
        total_usuarios: n.total_usuarios,
        total_clientes: n.total_clientes,
        total_servicios: n.total_servicios,
        total_ventas: n.total_ventas,
        ventas_hoy: n.ventas_hoy,
        ultima_actividad: n.ultima_actividad
    }));
    
    res.json(result);
});

router.get('/businesses/stats/growth', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const ultimosMeses = await db.collection('negocios').aggregate([
        {
            $match: {
                fecha_creacion: { $gte: twelveMonthsAgo }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$fecha_creacion' } },
                cantidad: { $sum: 1 }
            }
        },
        {
            $sort: { _id: 1 }
        },
        {
            $project: {
                _id: 0,
                mes: '$_id',
                cantidad: 1
            }
        }
    ]).toArray();
    
    const resumenDoc = await db.collection('negocios').aggregate([
        {
            $match: {
                estado: { $ne: 'eliminado' }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                activos: {
                    $sum: {
                        $cond: [
                            { $and: [
                                { $ne: ['$licencia_plan', 'trial'] },
                                { $ne: ['$licencia_plan', null] }
                            ]},
                            1,
                            0
                        ]
                    }
                },
                en_trial: {
                    $sum: {
                        $cond: [
                            { $or: [
                                { $eq: ['$licencia_plan', 'trial'] },
                                { $eq: ['$licencia_plan', null] }
                            ]},
                            1,
                            0
                        ]
                    }
                },
                suspendidos: {
                    $sum: {
                        $cond: [{ $eq: ['$estado', 'suspendido'] }, 1, 0]
                    }
                }
            }
        }
    ]).toArray();
    
    const resumen = resumenDoc[0] || { total: 0, activos: 0, en_trial: 0, suspendidos: 0 };
    
    res.json({
        mensual: ultimosMeses,
        resumen
    });
});

router.get('/businesses/:id', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(normalizeId(req.params.id));
    
    const negocio = await db.collection('negocios').findOne({ id: negocioId });
    
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const usuarios = await db.collection('usuarios')
        .find({ negocio_id: negocioId })
        .project({ id: 1, nombre: 1, email: 1, rol: 1, estado: 1, fecha_creacion: 1 })
        .toArray();
    
    const ventasRecientes = await db.collection('ventas').aggregate([
        { $match: { negocio_id: negocioId } },
        {
            $lookup: {
                from: 'clientes',
                localField: 'cliente_id',
                foreignField: 'id',
                as: 'clienteDoc'
            }
        },
        {
            $addFields: {
                cliente: { $arrayElemAt: ['$clienteDoc.nombre', 0] }
            }
        },
        {
            $project: {
                id: 1,
                total: 1,
                metodo_pago: 1,
                fecha: 1,
                cliente: 1
            }
        },
        { $sort: { fecha: -1 } },
        { $limit: 10 }
    ]).toArray();
    
    res.json({
        id: negocio.id,
        nombre: negocio.nombre,
        telefono: negocio.telefono,
        email: negocio.email,
        licencia_plan: negocio.licencia_plan,
        licencia_fecha_inicio: negocio.licencia_fecha_inicio,
        licencia_fecha_expiracion: negocio.licencia_fecha_expiracion,
        licencia_hardware_id: negocio.licencia_hardware_id,
        estado: negocio.estado,
        fecha_creacion: negocio.fecha_creacion,
        usuarios,
        ventasRecientes
    });
});

router.put('/businesses/:id/suspend', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(normalizeId(req.params.id));
    const { suspendido } = req.body;
    
    const negocio = await db.collection('negocios').findOne({ id: negocioId }, { projection: { id: 1 } });
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const nuevoEstado = suspendido ? 'suspendido' : 'activo';
    await db.collection('negocios').updateOne(
        { id: negocioId },
        { $set: { estado: nuevoEstado } }
    );
    
    res.json({ success: true, message: suspendido ? 'Negocio suspendido' : 'Negocio reactivado' });
});

router.delete('/businesses/:id', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const db = require('../database').getDb();
    const negocioId = parseInt(normalizeId(req.params.id));
    
    const negocio = await db.collection('negocios').findOne({ id: negocioId }, { projection: { id: 1, nombre: 1 } });
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    await db.collection('negocios').updateOne(
        { id: negocioId },
        { $set: { estado: 'eliminado' } }
    );
    
    await db.collection('usuarios').updateMany(
        { negocio_id: negocioId },
        { $set: { estado: 'inactivo' } }
    );
    
    res.json({ success: true, message: `Negocio "${negocio.nombre}" eliminado (soft delete)` });
});

router.post('/businesses/:id/renew', async (req, res) => {
    if (!isAuthorized(req)) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    const { plan, dias } = req.body;
    const negocioId = parseInt(normalizeId(req.params.id));
    
    if (!plan || !dias) {
        return res.status(400).json({ error: 'Plan y días requeridos' });
    }
    
    const db = require('../database').getDb();
    const negocio = await db.collection('negocios').findOne({ id: negocioId }, { projection: { id: 1 } });
    if (!negocio) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    
    const hoy = getRDDateString();
    const expiracion = getRDDate();
    expiracion.setDate(expiracion.getDate() + parseInt(dias));
    const fechaExpiracion = getRDDateString(expiracion);
    
    await db.collection('negocios').updateOne(
        { id: negocioId },
        {
            $set: {
                licencia_plan: plan,
                licencia_fecha_inicio: hoy,
                licencia_fecha_expiracion: fechaExpiracion,
                estado: 'activo'
            }
        }
    );
    
    res.json({ 
        success: true, 
        message: `Licencia renovada: ${plan} (${dias} días)`,
        fechaExpiracion 
    });
});

module.exports = router;
