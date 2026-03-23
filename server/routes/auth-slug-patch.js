// Este archivo contiene el código para modificar auth.js
// Agregar después de la línea 112 (const fechaInicio = new Date().toISOString();)

// Función para crear slug
function createSlug(nombre) {
    return nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Generar slug único
let slug = createSlug(nombreNegocio);
const existSlug = db.prepare('SELECT id FROM negocios WHERE slug = ?').get(slug);
if (existSlug) slug = slug + '-' + Date.now();

// Cambiar INSERT para incluir slug:
// INSERT INTO negocios (nombre, slug, telefono, email, licencia_fecha_inicio) 
// VALUES (?, ?, ?, ?, ?)
