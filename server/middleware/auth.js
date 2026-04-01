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

module.exports = { requireAuth, requireAdmin, requireNegocio };
