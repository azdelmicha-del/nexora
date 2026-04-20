const Database = require('better-sqlite3');

const db = new Database('./server/db/nexora.db');
const phone = '8297758300';

const pedidos = db.prepare(`
  SELECT id, numero_pedido, cliente_id, cliente_nombre, cliente_telefono, total, fecha
  FROM pedidos
  WHERE cliente_telefono LIKE ?
  ORDER BY id ASC
`).all(`%${phone}%`);

const clientes = db.prepare(`
  SELECT id, nombre, telefono, email, tipo_documento, documento
  FROM clientes
  WHERE telefono LIKE ?
  ORDER BY id ASC
`).all(`%${phone}%`);

console.log('PEDIDOS:');
console.log(JSON.stringify(pedidos, null, 2));
console.log('CLIENTES:');
console.log(JSON.stringify(clientes, null, 2));

const clienteIds = [...new Set(pedidos.map(p => p.cliente_id).filter(Boolean))];
console.log('CLIENTE_IDS_EN_PEDIDOS:', JSON.stringify(clienteIds));
console.log('TOTAL_CLIENTES_MATCH:', clientes.length);
console.log('TOTAL_PEDIDOS_MATCH:', pedidos.length);
