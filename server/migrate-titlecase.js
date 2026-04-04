/**
 * Migración: Normaliza nombres existentes a Title Case
 * Ejecutar UNA VEZ antes de deploy: node server/migrate-titlecase.js
 */
const path = require('path');
const fs = require('fs');
const { toTitleCase, capitalizeFirst } = require('./utils/validators');

// Setup DB
const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    console.log('No se encontró la base de datos. Abortando migración.');
    process.exit(0);
}
const dbPath = path.join(dbDir, 'nexora.db');
const Database = require('better-sqlite3');
const db = new Database(dbPath);

let totalUpdated = 0;

function migrateTable(table, column, formatter, label) {
    try {
        const rows = db.prepare(`SELECT id, ${column} FROM ${table}`).all();
        let updated = 0;
        
        const stmt = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);
        const transaction = db.transaction((id, value) => {
            stmt.run(value, id);
        });
        
        for (const row of rows) {
            const original = row[column];
            if (!original) continue;
            const fixed = formatter(original);
            if (fixed !== original) {
                transaction(row.id, fixed);
                updated++;
            }
        }
        
        if (updated > 0) {
            console.log(`  ✓ ${label}: ${updated} registros actualizados`);
            totalUpdated += updated;
        } else {
            console.log(`  - ${label}: sin cambios`);
        }
    } catch (e) {
        console.log(`  ✗ ${label}: error (${e.message})`);
    }
}

console.log('=== Migración Title Case ===\n');

// Nombres de personas → Title Case
console.log('Personas:');
migrateTable('clientes', 'nombre', toTitleCase, 'Clientes');
migrateTable('usuarios', 'nombre', toTitleCase, 'Usuarios');

// Nombres de servicios y productos → Title Case
console.log('\nServicios y Productos:');
migrateTable('servicios', 'nombre', toTitleCase, 'Servicios');
migrateTable('productos', 'nombre', toTitleCase, 'Productos');
migrateTable('categorias', 'nombre', toTitleCase, 'Categorías');

// Menú → Title Case
console.log('\nMenú Digital:');
migrateTable('menu_categorias', 'nombre', toTitleCase, 'Menú Categorías');
migrateTable('menu_items', 'nombre', toTitleCase, 'Menú Items');

// Descripciones → Sentence Case (capitalizeFirst)
console.log('\nDescripciones:');
migrateTable('servicios', 'descripcion', capitalizeFirst, 'Servicios descripción');
migrateTable('productos', 'descripcion', capitalizeFirst, 'Productos descripción');
migrateTable('menu_items', 'descripcion', capitalizeFirst, 'Menu Items descripción');

// Negocios → Title Case
console.log('\nNegocios:');
migrateTable('negocios', 'nombre', toTitleCase, 'Negocios nombre');
migrateTable('negocios', 'direccion', capitalizeFirst, 'Negocios dirección');

// Pedidos → Title Case
console.log('\nPedidos:');
migrateTable('pedidos', 'cliente_nombre', toTitleCase, 'Pedidos cliente_nombre');

// Estado resultado → Title Case
console.log('\nEstado Resultado:');
migrateTable('estado_resultado_items', 'descripcion', toTitleCase, 'Egresos descripción');

console.log(`\n=== Total: ${totalUpdated} registros actualizados ===`);
console.log('Migración completada.');

db.close();
