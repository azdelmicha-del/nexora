const Database = require('better-sqlite3');

const db = new Database('./server/db/nexora.db');

const pedidos = db.prepare(`
  SELECT id, numero_pedido, cliente_id, cliente_nombre, cliente_telefono, total, fecha
  FROM pedidos
  WHERE numero_pedido IN (4, 5)
  ORDER BY numero_pedido
`).all();

const ids = [...new Set(pedidos.map((p) => p.cliente_id).filter(Boolean))];
let clientes = [];
if (ids.length > 0) {
  const placeholders = ids.map(() => '?').join(',');
  clientes = db.prepare(`
    SELECT id, nombre, telefono, email, tipo_documento, documento
    FROM clientes
    WHERE id IN (${placeholders})
    ORDER BY id
  `).all(...ids);
}

console.log('PEDIDOS_4_5');
console.log(JSON.stringify(pedidos, null, 2));
console.log('CLIENTES_REFERENCIADOS');
console.log(JSON.stringify(clientes, null, 2));
