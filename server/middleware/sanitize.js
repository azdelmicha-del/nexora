const FIELDS_TO_SANITIZE = [
    'nombre', 'nombreNegocio', 'nombreAdmin', 'descripcion', 
    'notas', 'direccion', 'telefono', 'email'
];

function sanitizeInput(req, res, next) {
    if (req.body) {
        for (const key of FIELDS_TO_SANITIZE) {
            if (req.body[key] && typeof req.body[key] === 'string') {
                let value = req.body[key].trim();
                value = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                value = value.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
                value = value.replace(/on\w+\s*=/gi, '');
                value = value.replace(/javascript:/gi, '');
                req.body[key] = value;
            }
        }
    }
    next();
}

module.exports = { sanitizeInput };
