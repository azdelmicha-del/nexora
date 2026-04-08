const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
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

router.post('/registrar', async (req, res) => {
    try {
        const { nombreNegocio, rncNegocio, nombreAdmin, email, telefono, password } = req.body;
        
        if (!nombreNegocio || !nombreAdmin || !email || !password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }

        // Validar RNC si se proporcionó
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
        
        const existingEmail = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
        if (existingEmail) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        const existingTelefono = db.prepare('SELECT id FROM negocios WHERE telefono = ?').get(telefono);
        if (telefono && existingTelefono) {
            return res.status(400).json({ error: 'El número de teléfono ya está registrado' });
        }
        
        const existingNegocio = db.prepare('SELECT id FROM negocios WHERE nombre = ?').get(nombreNegocio);
        if (existingNegocio) {
            return res.status(400).json({ error: 'El nombre del negocio ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const negocioNombreNormalizado = toUpperCase(nombreNegocio.trim());
        const adminNombreNormalizado = toTitleCase(nombreAdmin.trim());
        const emailNormalizado = email.toLowerCase().trim();
        
        const fechaInicio = getRDDate().toISOString();
        
        // Generar slug automatico
        let slug = createSlug(nombreNegocio);
        const existSlug = db.prepare("SELECT id FROM negocios WHERE slug = ?").get(slug);
        if (existSlug) slug = slug + "-" + Date.now();
        
        const result = db.prepare(`
            INSERT INTO negocios (nombre, slug, telefono, email, rnc, licencia_fecha_inicio) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(negocioNombreNormalizado, slug, telefono || null, emailNormalizado, rncNegocio || null, fechaInicio);

        const negocioId = result.lastInsertRowid;

        db.prepare(`
            INSERT INTO usuarios (negocio_id, nombre, email, password, rol) 
            VALUES (?, ?, ?, ?, 'admin')
        `).run(negocioId, adminNombreNormalizado, emailNormalizado, hashedPassword);

        const user = db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE email = ?').get(email);
        
        req.session.userId = user.id;
        req.session.negocioId = negocioId;
        req.session.rol = user.rol;
        req.session.nombre = user.nombre;
        req.session.email = email;

        // Obtener tipo de negocio para el sidebar
        const negocioConfig = db.prepare('SELECT tipo_negocio FROM negocios WHERE id = ?').get(negocioId);
        req.session.tipo_negocio = (negocioConfig && negocioConfig.tipo_negocio) || 'ambos';

        const license = require('../license');
        license.recordTrialStart(negocioId);

        res.json({
            success: true,
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            },
            negocioId: negocioId
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
        
        const user = db.prepare(`
            SELECT u.id, u.nombre, u.email, u.password, u.rol, u.negocio_id, u.estado, u.last_login, u.fecha_creacion,
                   u.login_attempts, u.last_attempt,
                   n.estado as negocio_estado
            FROM usuarios u
            JOIN negocios n ON u.negocio_id = n.id
            WHERE u.email = ?
        `).get(emailLower);

        if (!user) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        if (user.estado !== 'activo') {
            return res.status(401).json({ error: 'Usuario desactivado' });
        }

        if (user.negocio_estado !== 'activo') {
            return res.status(401).json({ error: 'Negocio suspendido' });
        }
        
        // Verificar bloqueo por intentos fallidos
        const MAX_ATTEMPTS = 3;
        const LOCKOUT_MINUTES = 15;
        
        if (user.login_attempts >= MAX_ATTEMPTS && user.last_attempt) {
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
                db.prepare('UPDATE usuarios SET login_attempts = 0, last_attempt = NULL WHERE id = ?').run(user.id);
                user.login_attempts = 0;
            }
        }
        
        const license = require('../license');
        let licenseStatus = license.isLicenseValid(user.negocio_id);
        // NOTA: No bloqueamos el login por licencia expirada
        // Solo se muestra advertencia en el frontend
        
        const INACTIVITY_DAYS = 30;
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
            db.prepare('UPDATE usuarios SET login_attempts = ?, last_attempt = ? WHERE id = ?')
                .run(newAttempts, getRDDate().toISOString(), user.id);
            
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
        
        // Resetear intentos en login exitoso
        db.prepare('UPDATE usuarios SET login_attempts = 0, last_attempt = NULL WHERE id = ?').run(user.id);
        
        db.prepare('UPDATE usuarios SET last_login = ? WHERE id = ?').run(getRDDate().toISOString(), user.id);

        req.session.userId = user.id;
        req.session.negocioId = user.negocio_id;
        req.session.rol = user.rol;
        req.session.nombre = user.nombre;
        req.session.email = user.email;

        license.recordTrialStart(user.negocio_id);

        res.json({
            success: true,
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            },
            negocioId: user.negocio_id,
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

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

router.get('/session', (req, res) => {
    if (!req.session.userId) {
        return res.json({ authenticated: false });
    }
    
    // Obtener días restantes de licencia
    const license = require('../license');
    const licenseStatus = license.isLicenseValid(req.session.negocioId);
    
    res.json({
        authenticated: true,
        user: {
            id: req.session.userId,
            nombre: req.session.nombre,
            email: req.session.email,
            rol: req.session.rol
        },
        negocioId: req.session.negocioId,
        license: {
            daysRemaining: licenseStatus.daysRemaining,
            type: licenseStatus.type,
            valid: licenseStatus.valid
        }
    });
});

// Endpoint para obtener info de licencia
router.get('/license-info', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    
    const userEmail = req.session.email;
    
    // Todos los usuarios pasan por validación de licencia normal
    
    const license = require('../license');
    const licenseStatus = license.isLicenseValid(req.session.negocioId);
    
    res.json({
        daysRemaining: licenseStatus.daysRemaining,
        type: licenseStatus.type,
        valid: licenseStatus.valid,
        isOwner: false,
        licenciaPlan: licenseStatus.licenciaPlan,
        licenciaFechaInicio: licenseStatus.licenciaFechaInicio,
        licenciaFechaExpiracion: licenseStatus.licenciaFechaExpiracion
    });
});

module.exports = router;
