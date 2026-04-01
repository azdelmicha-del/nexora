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
    const url = req.originalUrl || req.url;
    
    // Rutas exentas de verificación de licencia
    if (url === '/' || url === '/actualizar' || url.startsWith('/actualizar?') ||
        url.startsWith('/api/auth') || url.startsWith('/api/license') || 
        url.startsWith('/api/superadmin') || url.startsWith('/api/public') ||
        url.startsWith('/superadmin') || url.startsWith('/booking') || 
        url.startsWith('/api/booking') || url.startsWith('/registro') ||
        url.startsWith('/css/') || url.startsWith('/js/') || 
        url.startsWith('/api/debug')) {
        return next();
    }
    
    // Solo verificar si tiene negocio
    if (!req.session.negocioId) {
        return next();
    }
    
    try {
        const license = require('../license');
        const status = license.isLicenseValid(req.session.negocioId);
        
        // Licencia válida con días restantes → continuar
        if (status.valid && status.daysRemaining > 0) {
            return next();
        }
        
        // Licencia expirada → bloquear
        if (url.startsWith('/api/')) {
            return res.status(403).json({ 
                error: 'Licencia expirada', 
                redirect: '/actualizar',
                daysRemaining: status.daysRemaining || 0,
                type: status.type
            });
        }
        
        return res.redirect('/actualizar');
    } catch (error) {
        console.error('Error verificando licencia:', error);
        return next();
    }
}

module.exports = { requireAuth, requireAdmin, requireNegocio, requireActiveLicense };
