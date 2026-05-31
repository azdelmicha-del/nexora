const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb , normalizeId } = require('../database');
const { autoBackup } = require('../backup-protection');
const { getRDDateString, getRDDate } = require('../utils/timezone');

const router = express.Router();

// DEBUG ROUTE ELIMINADA: exponia datos internos sin autenticacion (security fix)

function toTitleCase(str) {
    return String(str).toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

function createSlug(nombre) {
    return nombre.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function toUpperCase(str) {
    return String(str).toUpperCase();
}

function normalizeSelectedPlan(rawPlan) {
    const plan = String(rawPlan || 'trial').toLowerCase().trim();
    const planMap = {
        trial: 'trial',
        mensual: 'monthly',
        monthly: 'monthly',
        semestral: 'semiannual',
        semiannual: 'semiannual',
        anual: 'annual',
        annual: 'annual'
    };
    return planMap[plan] || 'trial';
}

router.post('/registrar', async (req, res) => {
    try {
        const { nombreNegocio, rncNegocio, nombreAdmin, email, telefono, password, selectedPlan } = req.body;
        
        if (!nombreNegocio || !nombreAdmin || !email || !password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }

        if (rncNegocio) {
            const rncClean = String(rncNegocio).replace(/[\s\-]/g, '');
            if (rncClean.length !== 9 && rncClean.length !== 11) {
                return res.status(400).json({ error: 'RNC Inválido: Debe tener 9 dígitos (Jurídico) u 11 dígitos (Cédula)' });
            }
            if (!/^\d+$/.test(rncClean)) {
                return res.status(400).json({ error: 'RNC Inválido: Solo se permiten números' });
            }
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }
        
        const allowedDomains = ['gmail.com', 'hotmail.com', 'hotmail.es', 'yahoo.com', 'outlook.com', 'live.com'];
        const emailDomain = email.split('@')[1]?.toLowerCase();
        
        if (!allowedDomains.includes(emailDomain)) {
            return res.status(400).json({ error: 'Solo se permiten correos de Gmail, Hotmail, Yahoo o Outlook' });
        }
        
        if (telefono) {
            const phoneRegex = /^[\+]?[\d\s\-\(\)]{10,20}$/;
            if (!phoneRegex.test(telefono)) {
                return res.status(400).json({ error: 'Número de teléfono inválido. Formato: +1 (809) 555-1234' });
            }
            
            const digitsOnly = telefono.replace(/[\D]/g, '');
            if (digitsOnly.length < 10 || digitsOnly.length > 15) {
                return res.status(400).json({ error: 'El teléfono debe tener entre 10 y 15 dígitos' });
            }
        }

        if (nombreNegocio.length > 100 || nombreAdmin.length > 100) {
            return res.status(400).json({ error: 'Los nombres no pueden exceder 100 caracteres' });
        }

        const db = getDb();
        
        const existingEmail = await db.collection('usuarios').findOne({ email: email }, { projection: { _id: 1 } });
        if (existingEmail) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        const existingTelefono = await db.collection('negocios').findOne({ telefono: telefono }, { projection: { _id: 1 } });
        if (telefono && existingTelefono) {
            return res.status(400).json({ error: 'El número de teléfono ya está registrado' });
        }
        
        const negocioNombreNormalizado = toUpperCase(nombreNegocio.trim());
        const existingNegocio = await db.collection('negocios').findOne({ nombre: negocioNombreNormalizado }, { projection: { _id: 1 } });
        if (existingNegocio) {
            return res.status(400).json({ error: 'El nombre del negocio ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const adminNombreNormalizado = toTitleCase(nombreAdmin.trim());
        const emailNormalizado = email.toLowerCase().trim();
        const planSeleccionado = normalizeSelectedPlan(selectedPlan);
        
        const fechaInicio = getRDDate().toISOString();
        
        let slug = createSlug(nombreNegocio);
        const existSlug = await db.collection('negocios').findOne({ slug: slug }, { projection: { _id: 1 } });
        if (existSlug) slug = slug + "-" + Date.now();
        
        const session = await db.startSession();
        let negocioId;
        
        try {
            await session.withTransaction(async () => {
                const negocioResult = await db.collection('negocios').insertOne({
                    nombre: negocioNombreNormalizado,
                    slug: slug,
                    telefono: telefono || null,
                    email: emailNormalizado,
                    rnc: rncNegocio || null,
                    licencia_plan: 'trial',
                    plan_seleccionado: planSeleccionado,
                    licencia_fecha_inicio: fechaInicio
                }, { session });

                negocioId = negocioResult.insertedId;

                await db.collection('usuarios').insertOne({
                    negocio_id: negocioId,
                    nombre: adminNombreNormalizado,
                    email: emailNormalizado,
                    password: hashedPassword,
                    rol: 'admin'
                }, { session });
            });
        } finally {
            await session.endSession();
        }

        const user = await db.collection('usuarios').findOne(
            { email: emailNormalizado },
            { projection: { _id: 1, nombre: 1, email: 1, rol: 1 } }
        );
        
        req.session.userId = user._id.toString();
        req.session.negocioId = negocioId.toString();
        req.session.rol = user.rol;
        req.session.nombre = user.nombre;
        req.session.email = emailNormalizado;

        const negocioConfig = await db.collection('negocios').findOne(
            { _id: negocioId },
            { projection: { tipo_negocio: 1 } }
        );
        req.session.tipo_negocio = (negocioConfig && negocioConfig.tipo_negocio) || 'ambos';

        const license = require('../license');
        license.recordTrialStart(negocioId);

        autoBackup();

        res.json({
            success: true,
            user: {
                id: user._id.toString(),
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            },
            negocioId: negocioId.toString(),
            selectedPlan: planSeleccionado,
            licenseStatus: 'trial'
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }

        const db = getDb();
        
        const emailLower = email.toLowerCase().trim();
        
        const user = await db.collection('usuarios').findOne({ email: emailLower });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        if (user.estado && user.estado !== 'activo') {
            return res.status(401).json({ error: 'Usuario desactivado' });
        }

        const negocio = await db.collection('negocios').findOne({ _id: user.negocio_id });
        if (!negocio || (negocio.estado && negocio.estado !== 'activo')) {
            return res.status(401).json({ error: 'Negocio suspendido' });
        }
        
        const MAX_ATTEMPTS = 3;
        const LOCKOUT_MINUTES = 15;
        
        if ((user.login_attempts || 0) >= MAX_ATTEMPTS && user.last_attempt) {
            const lastAttempt = new Date(user.last_attempt);
            const minutesSince = (getRDDate() - lastAttempt) / (1000 * 60);
            
            if (minutesSince < LOCKOUT_MINUTES) {
                const minutesRemaining = Math.ceil(LOCKOUT_MINUTES - minutesSince);
                return res.status(429).json({
                    error: 'account_locked',
                    message: `Has excedido el número máximo de intentos. Intenta de nuevo en ${minutesRemaining} minutos.`,
                    minutesRemaining: minutesRemaining,
                    locked: true
                });
            } else {
                await db.collection('usuarios').updateOne(
                    { _id: user._id },
                    { $set: { login_attempts: 0, last_attempt: null } }
                );
                user.login_attempts = 0;
            }
        }
        
        const license = require('../license');
        let licenseStatus = await license.isLicenseValid(user.negocio_id);
        
        const INACTIVITY_DAYS = 365;
        const lastLogin = user.last_login ? new Date(user.last_login) : new Date(user.fecha_creacion);
        const daysSinceLastLogin = Math.floor((getRDDate() - lastLogin) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastLogin > INACTIVITY_DAYS) {
            return res.status(403).json({ 
                error: 'Cuenta inactiva',
                message: `Tu cuenta ha estado inactiva por ${daysSinceLastLogin} días. Contacta al soporte técnico para reactivarla.`
            });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            const newAttempts = (user.login_attempts || 0) + 1;
            await db.collection('usuarios').updateOne(
                { _id: user._id },
                { $set: { login_attempts: newAttempts, last_attempt: getRDDate().toISOString() } }
            );
            
            if (newAttempts >= MAX_ATTEMPTS) {
                return res.status(429).json({
                    error: 'account_locked',
                    message: `Has excedido el número máximo de intentos. Intenta de nuevo en ${LOCKOUT_MINUTES} minutos.`,
                    minutesRemaining: LOCKOUT_MINUTES,
                    locked: true
                });
            }
            
            return res.status(401).json({
                error: 'Credenciales incorrectas',
                attemptsRemaining: MAX_ATTEMPTS - newAttempts
            });
        }
        
        await db.collection('usuarios').updateOne(
            { _id: user._id },
            { $set: { login_attempts: 0, last_attempt: null } }
        );
        
        await db.collection('usuarios').updateOne(
            { _id: user._id },
            { $set: { last_login: getRDDate().toISOString() } }
        );

        req.session.userId = user._id.toString();
        req.session.negocioId = user.negocio_id.toString();
        req.session.rol = user.rol;
        req.session.nombre = user.nombre;
        req.session.email = user.email;

        license.recordTrialStart(user.negocio_id);

        res.json({
            success: true,
            user: {
                id: user._id.toString(),
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            },
            negocioId: user.negocio_id.toString(),
            license: {
                daysRemaining: licenseStatus.daysRemaining,
                type: licenseStatus.type
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

router.post('/logout', async (req, res) => {
    const db = getDb();
    const userId = req.session.userId;
    
    req.session.destroy();
    
    if (userId) {
        try {
            await db.collection('usuarios').updateOne(
                { _id: userId },
                { $set: { login_attempts: 0, last_attempt: null } }
            );
        } catch (e) { /* no bloquear logout por error de DB */ }
    }
    
    res.json({ success: true });
});

router.get('/session', async (req, res) => {
    if (!req.session.userId) {
        return res.json({ authenticated: false });
    }

    const license = require('../license');
    const licenseStatus = await license.isLicenseValid(normalizeId(req.session.negocioId));

    res.json({
        authenticated: true,
        user: {
            id: req.session.userId,
            nombre: req.session.nombre,
            email: req.session.email,
            rol: req.session.rol
        },
        negocioId: normalizeId(req.session.negocioId),
        license: {
            daysRemaining: licenseStatus.daysRemaining,
            type: licenseStatus.type,
            valid: licenseStatus.valid
        }
    });
});

router.get('/license-info', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    
    const db = getDb();
    const license = require('../license');
    const licenseStatus = await license.isLicenseValid(normalizeId(req.session.negocioId));

    const negocio = await db.collection('negocios').findOne(
        { _id: normalizeId(req.session.negocioId) },
        { projection: { plan_seleccionado: 1 } }
    );
    const planSeleccionado = negocio ? (negocio.plan_seleccionado || 'trial') : 'trial';

    res.json({
        daysRemaining: licenseStatus.daysRemaining,
        type: licenseStatus.type,
        valid: licenseStatus.valid,
        isOwner: false,
        planSeleccionado,
        licenciaPlan: licenseStatus.licenciaPlan,
        licenciaFechaInicio: licenseStatus.licenciaFechaInicio,
        licenciaFechaExpiracion: licenseStatus.licenciaFechaExpiracion
    });
});

module.exports = router;
