const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'db', 'nexora.db'));

function createSlug(nombre) {
    return nombre.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

console.log('Iniciando migracion...\n');

try { db.exec('ALTER TABLE negocios ADD COLUMN slug TEXT UNIQUE'); console.log('OK: slug agregado a negocios'); } 
catch(e) { console.log('SKIP: slug ya existe en negocios'); }

try { db.exec('ALTER TABLE negocios ADD COLUMN booking_activo INTEGER DEFAULT 1'); console.log('OK: booking_activo agregado a negocios'); } 
catch(e) { console.log('SKIP: booking_activo ya existe en negocios'); }

try { db.exec('ALTER TABLE citas ADD COLUMN origen TEXT DEFAULT "interno"'); console.log('OK: origen agregado a citas'); } 
catch(e) { console.log('SKIP: origen ya existe en citas'); }

console.log('\nGenerando slugs para negocios existentes...\n');

const negocios = db.prepare('SELECT id, nombre FROM negocios WHERE slug IS NULL').all();

if (negocios.length === 0) {
    console.log('No hay negocios sin slug');
} else {
    negocios.forEach(n => {
        let slug = createSlug(n.nombre);
        const exist = db.prepare('SELECT id FROM negocios WHERE slug = ?').get(slug);
        if (exist) slug = slug + '-' + n.id;
        db.prepare('UPDATE negocios SET slug = ? WHERE id = ?').run(slug, n.id);
        console.log(n.nombre + ' => ' + slug);
    });
}

console.log('\nMigracion completada!');
db.close();
