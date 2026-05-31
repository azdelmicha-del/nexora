/**
 * Limpia datos de Nexora V_0.2 de la DB nexora_pos en MongoDB Atlas
 * Lee SQLite de Nexora V_0.2 y borra solo esos documentos
 *
 * Uso: node cleanup-nexora-pos.js
 * Requiere MONGODB_URI en .env
 */

const Database = require('better-sqlite3');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('ERROR: MONGODB_URI no configurada en .env');
    process.exit(1);
}

const SQLITE_PATH = path.join(__dirname, 'server', 'db', 'nexora.db');
if (!fs.existsSync(SQLITE_PATH)) {
    console.error('ERROR: SQLite no encontrada en:', SQLITE_PATH);
    process.exit(1);
}

const TABLES = [
    'negocios','usuarios','categorias','servicios','clientes',
    'ventas','venta_detalles','citas','notificaciones','conversaciones',
    'cajas_cerradas','estado_resultado_items','secuencias_ncf',
    'certificados_dgii','notas_credito','config','productos',
    'movimientos_inventario','comisiones','chatbot_reglas','chatbot_mensajes',
    'log_auditoria','puntos_lealtad','historial_puntos','horario_negocio',
    'sucursales','whatsapp_config','menu_categorias','menu_items',
    'pedidos','pedidos_items','platform_config'
];

async function cleanup() {
    console.log('=== Limpieza: datos de Nexora V_0.2 en nexora_pos ===\n');

    const sqlite = new Database(SQLITE_PATH, { readonly: true });
    console.log('✅ SQLite conectado:', SQLITE_PATH);

    await mongoose.connect(MONGODB_URI, { dbName: 'nexora_pos' });
    console.log('✅ MongoDB conectado (db: nexora_pos)\n');
    const db = mongoose.connection;

    let totalDeleted = 0;

    for (const table of TABLES) {
        try {
            const exists = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
            if (!exists) continue;

            const rows = sqlite.prepare(`SELECT id FROM ${table}`).all();
            if (rows.length === 0) continue;

            const ids = rows.map(r => r.id);
            const result = await db.collection(table).deleteMany({ _id: { $in: ids } });
            totalDeleted += result.deletedCount;

            console.log(`🗑️  ${table}: borrados ${result.deletedCount} documentos`);
        } catch (e) {
            console.error(`❌ Error en ${table}:`, e.message.substring(0, 100));
        }
    }

    console.log(`\n✅ Total eliminados de nexora_pos: ${totalDeleted}`);
    console.log('✅ Ya puedes migrar Nexora V_0.2 a su propia DB: npm run migrate');

    sqlite.close();
    await mongoose.disconnect();
    process.exit(0);
}

cleanup().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
