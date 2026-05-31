/**
 * Script de migracion: SQLite → MongoDB Atlas
 * 
 * Uso: node server/migrate-sqlite-to-mongo.js
 * 
 * Requisitos:
 *  - MONGODB_URI en .env o como variable de entorno
 *  - La BD SQLite debe estar en server/db/nexora.db
 * 
 * Este script:
 *  1. Lee todos los datos de SQLite
 *  2. Los inserta en MongoDB (database: nexora)
 *  3. NO borra datos de SQLite (backup de seguridad)
 *  4. Es idempotente: si ya existen datos, los actualiza
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

const SQLITE_PATH = process.env.DB_DIR
    ? path.join(process.env.DB_DIR, 'nexora.db')
    : path.join(__dirname, 'db', 'nexora.db');
if (!fs.existsSync(SQLITE_PATH)) {
    console.error('ERROR: BD SQLite no encontrada en:', SQLITE_PATH);
    process.exit(1);
}

// Tablas a migrar (en orden para respetar foreign keys)
const TABLES = [
    'negocios',
    'usuarios',
    'categorias',
    'servicios',
    'clientes',
    'ventas',
    'venta_detalles',
    'citas',
    'notificaciones',
    'conversaciones',
    'cajas_cerradas',
    'estado_resultado_items',
    'secuencias_ncf',
    'certificados_dgii',
    'notas_credito',
    'config',
    'productos',
    'movimientos_inventario',
    'comisiones',
    'chatbot_reglas',
    'chatbot_mensajes',
    'log_auditoria',
    'puntos_lealtad',
    'historial_puntos',
    'horario_negocio',
    'sucursales',
    'whatsapp_config',
    'menu_categorias',
    'menu_items',
    'pedidos',
    'pedidos_items',
    'platform_config'
];

const NEGOCIO_IDS_V2 = [1, 16, 18]; // IDs de negocios de Nexora V_0.2

async function cleanupNexoraPos(sqlite) {
    console.log('=== Paso 1: Limpieza de nexora_pos (datos de V_0.2) ===\n');

    // Obtener IDs de ventas y pedidos de V_0.2 para limpiar tablas hijas
    const ventaIds = sqlite.prepare('SELECT id FROM ventas').all().map(r => r.id);
    const pedidoIds = sqlite.prepare('SELECT id FROM pedidos').all().map(r => r.id);

    await mongoose.connect(MONGODB_URI, { dbName: 'nexora_pos' });
    let totalDeleted = 0;

    // Tablas con negocio_id (seguro: filtrar por IDs de V_0.2)
    const conNegocioId = [
        'negocios','usuarios','categorias','servicios','clientes','ventas',
        'citas','notificaciones','conversaciones','cajas_cerradas',
        'estado_resultado_items','secuencias_ncf','certificados_dgii','notas_credito',
        'productos','movimientos_inventario','comisiones','chatbot_reglas',
        'chatbot_mensajes','puntos_lealtad','historial_puntos','horario_negocio',
        'sucursales','whatsapp_config','menu_categorias','menu_items','pedidos'
    ];

    for (const name of conNegocioId) {
        const col = mongoose.connection.collection(name);
        const filter = name === 'negocios'
            ? { _id: { $in: NEGOCIO_IDS_V2 } }
            : { negocio_id: { $in: NEGOCIO_IDS_V2 } };
        const r = await col.deleteMany(filter);
        if (r.deletedCount > 0) {
            console.log(`  🗑️  ${name}: ${r.deletedCount} eliminados`);
            totalDeleted += r.deletedCount;
        }
    }

    // Tablas hijas (sin negocio_id, se limpian por ID de padre)
    if (ventaIds.length > 0) {
        const r = await mongoose.connection.collection('venta_detalles').deleteMany({ venta_id: { $in: ventaIds } });
        if (r.deletedCount > 0) { console.log(`  🗑️  venta_detalles: ${r.deletedCount} eliminados`); totalDeleted += r.deletedCount; }
    }
    if (pedidoIds.length > 0) {
        const r = await mongoose.connection.collection('pedidos_items').deleteMany({ pedido_id: { $in: pedidoIds } });
        if (r.deletedCount > 0) { console.log(`  🗑️  pedidos_items: ${r.deletedCount} eliminados`); totalDeleted += r.deletedCount; }
    }

    console.log(`\n✅ Total eliminado de nexora_pos: ${totalDeleted} documentos\n`);
    await mongoose.disconnect();
}

async function migrate() {
    console.log('=== Migracion SQLite → MongoDB ===\n');

    // Conectar a SQLite
    const sqlite = new Database(SQLITE_PATH, { readonly: true });
    console.log('✅ SQLite conectado:', SQLITE_PATH);

    // Limpiar nexora_pos (datos de V_0.2 que se migraron por error en la primera ejecucion)
    await cleanupNexoraPos(sqlite);

    // Conectar a MongoDB (db: nexora)
    await mongoose.connect(MONGODB_URI, {
        dbName: 'nexora'
    });
    console.log('✅ MongoDB conectado (db: nexora)\n');

    let totalDocs = 0;

    for (const table of TABLES) {
        try {
            // Verificar si la tabla existe
            const tableExists = sqlite.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
            ).get(table);

            if (!tableExists) {
                console.log(`⏭️  Tabla ${table} no existe, saltando...`);
                continue;
            }

            // Leer todos los registros
            const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

            if (rows.length === 0) {
                console.log(`⏭️  Tabla ${table} vacia, saltando...`);
                continue;
            }

            // Convertir a documentos MongoDB
            const docs = rows.map(row => {
                const doc = { ...row };
                // Eliminar campos undefined
                Object.keys(doc).forEach(key => {
                    if (doc[key] === undefined) delete doc[key];
                });
                // Convertir BigInt a Number si existe
                Object.keys(doc).forEach(key => {
                    if (typeof doc[key] === 'bigint') {
                        doc[key] = Number(doc[key]);
                    }
                });
                return doc;
            });

            // Insertar en MongoDB (upsert por _id)
            const collection = mongoose.connection.collection(table);
            let inserted = 0;
            let updated = 0;

            for (const doc of docs) {
                const oldId = doc.id;
                delete doc.id; // MongoDB usa _id

                const result = await collection.updateOne(
                    { _id: oldId },
                    { $set: { ...doc, _id: oldId } },
                    { upsert: true }
                );

                if (result.upsertedCount > 0) inserted++;
                if (result.modifiedCount > 0) updated++;
            }

            totalDocs += docs.length;
            console.log(`✅ ${table}: ${docs.length} documentos (${inserted} nuevos, ${updated} actualizados)`);

        } catch (error) {
            console.error(`❌ Error migrando tabla ${table}:`, error.message);
        }
    }

    // Crear indexes en MongoDB
    console.log('\n📇 Creando indexes...');
    const indexes = [
        { collection: 'usuarios', fields: { negocio_id: 1 } },
        { collection: 'usuarios', fields: { email: 1 }, options: { unique: true } },
        { collection: 'servicios', fields: { negocio_id: 1 } },
        { collection: 'categorias', fields: { negocio_id: 1 } },
        { collection: 'clientes', fields: { negocio_id: 1 } },
        { collection: 'ventas', fields: { negocio_id: 1 } },
        { collection: 'ventas', fields: { fecha: -1 } },
        { collection: 'venta_detalles', fields: { venta_id: 1 } },
        { collection: 'citas', fields: { negocio_id: 1 } },
        { collection: 'citas', fields: { fecha: 1 } },
        { collection: 'notificaciones', fields: { negocio_id: 1 } },
        { collection: 'productos', fields: { negocio_id: 1 } },
        { collection: 'movimientos_inventario', fields: { negocio_id: 1 } },
        { collection: 'movimientos_inventario', fields: { producto_id: 1 } },
        { collection: 'comisiones', fields: { negocio_id: 1 } },
        { collection: 'comisiones', fields: { user_id: 1 } },
        { collection: 'pedidos', fields: { negocio_id: 1 } },
        { collection: 'pedidos_items', fields: { pedido_id: 1 } },
        { collection: 'secuencias_ncf', fields: { negocio_id: 1, tipo_comprobante: 1 }, options: { unique: true } },
        { collection: 'puntos_lealtad', fields: { negocio_id: 1, cliente_id: 1 }, options: { unique: true } },
        { collection: 'menu_categorias', fields: { negocio_id: 1 } },
        { collection: 'menu_items', fields: { negocio_id: 1 } },
        { collection: 'menu_items', fields: { categoria_id: 1 } },
    ];

    for (const idx of indexes) {
        try {
            const collection = mongoose.connection.collection(idx.collection);
            await collection.createIndex(idx.fields, idx.options || {});
        } catch (e) {
            // Index ya existe, ignorar
        }
    }
    console.log('✅ Indexes creados');

    // Resumen
    console.log('\n=== Resumen de Migracion ===');
    console.log(`Total documentos migrados: ${totalDocs}`);
    console.log(`Base de datos MongoDB: nexora`);
    console.log(`Colecciones: ${TABLES.length}`);
    console.log('\n✅ Migracion completada!');
    console.log('\n⚠️  IMPORTANTE:');
    console.log('   1. Verifica los datos en MongoDB Atlas antes de deployar');
    console.log('   2. La BD SQLite original NO fue modificada');
    console.log('   3. Actualiza MONGODB_URI en Render antes de deployar');
    console.log('   4. Elimina el disco persistente de render.yaml');

    sqlite.close();
    await mongoose.disconnect();
    process.exit(0);
}

migrate().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
