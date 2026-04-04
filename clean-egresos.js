const { getDb, initDatabase } = require('./server/database');
const db = initDatabase();

// Find corrupted records (where fields have wrong types)
const all = db.prepare('SELECT id, subtotal, monto, fecha FROM estado_resultado_items WHERE negocio_id = 1').all();

const corruptIds = all.filter(r => {
    return typeof r.subtotal === 'string' 
        || typeof r.monto !== 'number' 
        || !r.fecha 
        || r.fecha === '0.0'
        || typeof r.fecha !== 'string'
        || r.fecha.length < 8;
}).map(r => r.id);

console.log('Found', corruptIds.length, 'corrupt records:', corruptIds.join(', '));

if (corruptIds.length > 0) {
    const placeholders = corruptIds.map(() => '?').join(',');
    db.prepare('DELETE FROM estado_resultado_items WHERE id IN (' + placeholders + ')').run(...corruptIds);
    console.log('Deleted', corruptIds.length, 'corrupt records');
}

// Show remaining records by category
const remaining = db.prepare(`
    SELECT categoria, COUNT(*) as count, COALESCE(SUM(monto),0) as total 
    FROM estado_resultado_items 
    WHERE negocio_id = 1 AND tipo = 'gasto'
    GROUP BY categoria
`).all();

console.log('\nRemaining cost records:');
remaining.forEach(r => {
    console.log('  ' + r.categoria + ': ' + r.count + ' records, RD$' + r.total.toFixed(2));
});
