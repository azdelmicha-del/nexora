function requireAuth(req, res, next) {
    if (!req.session.userId) {
        // Si es una petición HTML (navegador), redirigir al login
        if (req.accepts('html')) {
            return res.redirect('/');
        }
        // Si es API, devolver JSON
        return res.status(401).json({ error: 'No autenticado' });
    }
    next();
}

function requireAdmin(req, res, next) {
    // Permitir superadmin (tiene acceso total)
    if (req.session.superAdminId) {
        return next();
    }
    
    if (!req.session.userId) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    const role = req.session.rol;
    const isAdmin = role === 'admin' || role === 'superadmin';
    if (!isAdmin) {
        return res.status(403).json({ error: 'Acceso denegado' });
    }
    next();
}

function requireNegocio(req, res, next) {
    if (!req.session.negocioId) {
        return res.status(403).json({ error: 'Negocio no seleccionado' });
    }
    next();
}

function requireActiveLicense(req, res, next) {
    // Rutas exentas de verificación de licencia
    const exemptPaths = [
        '/actualizar',
        '/api/auth',
        '/api/license',
        '/api/superadmin',
        '/superadmin',
        '/booking',
        '/',
        '/css/',
        '/js/',
        '/api/booking'
    ];
    
    const isExempt = exemptPaths.some(p => req.path === p || req.path.startsWith(p));
    if (isExempt) {
        return next();
    }
    
    // Solo verificar si está autenticado y tiene negocio
    if (!req.session.userId || !req.session.negocioId) {
        return next();
    }
    
    try {
        const license = require('../license');
        const status = license.isLicenseValid(req.session.negocioId);
        
        // Licencia válida → continuar
        if (status.valid && status.daysRemaining > 0) {
            return next();
        }
        
        // Licencia expirada → bloquear
        if (req.accepts('html') && !req.path.startsWith('/api/')) {
            return res.redirect('/actualizar');
        }
        
        return res.status(403).json({ 
            error: 'Licencia expirada', 
            redirect: '/actualizar',
            daysRemaining: status.daysRemaining,
            type: status.type
        });
    } catch (error) {
        console.error('Error verificando licencia:', error);
        return next();
    }
}

module.exports = { requireAuth, requireAdmin, requireNegocio, requireActiveLicense };
