const { execSync } = require('child_process');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function getAtlasHosts() {
  const psOut = execSync(
    'powershell -Command "$r=Resolve-DnsName _mongodb._tcp.nexorabot.cjiupyo.mongodb.net -Type SRV; $r | ForEach-Object { $_.NameTarget + \":\" + $_.Port }"',
    { encoding: 'utf8', timeout: 10000 }
  );
  return psOut.trim().split('\r\n').filter(Boolean);
}

async function getShardIp(host) {
  const name = host.split(':')[0];
  const psOut = execSync(
    `powershell -Command "(Resolve-DnsName -Name ${name} -Type A).IPAddress -join ','"`,
    { encoding: 'utf8', timeout: 10000 }
  );
  return psOut.trim();
}

async function main() {
  console.log('=== Limpieza: datos de Nexora V_0.2 en nexora_pos ===\n');

  const sqlitePath = path.join(__dirname, 'server', 'db', 'nexora.db');
  const sqlite = require('better-sqlite3')(sqlitePath);
  console.log(`✅ SQLite conectado: ${sqlitePath}`);

  const hosts = await getAtlasHosts();
  console.log('🔍 Hosts SRV resueltos:', hosts);

  const hostEntries = [];
  for (const h of hosts) {
    const ip = await getShardIp(h);
    hostEntries.push({ host: h, ip });
  }
  console.log('🌐 IPs resueltas:', hostEntries.map(h => `${h.host} -> ${h.ip}`).join(', '));

  const directHosts = hostEntries.map(h => `${h.ip}:${h.host.split(':')[1]}`).join(',');
  const mongoUri = `mongodb://admin:Nexora2024@${directHosts}/?replicaSet=atlas-br0m7f-shard-0&ssl=true&authSource=admin&retryWrites=true&w=majority`;

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 20000,
    dbName: 'nexora_pos',
  });
  console.log('✅ Conectado a MongoDB Atlas (nexora_pos)\n');

  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  let totalDeleted = 0;

  for (const t of tables) {
    const tableName = t.name;
    const ids = sqlite.prepare(`SELECT id FROM "${tableName}"`).all().map(r => r.id);
    if (ids.length === 0) continue;

    const col = mongoose.connection.collection(tableName);
    const result = await col.deleteMany({ _id: { $in: ids } });
    if (result.deletedCount > 0) {
      console.log(`  🗑️  ${tableName}: ${result.deletedCount} documentos eliminados`);
      totalDeleted += result.deletedCount;
    }
  }

  console.log(`\n✅ Total eliminado de nexora_pos: ${totalDeleted} documentos`);
  await mongoose.connection.close();
  sqlite.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error fatal:', e.message);
  process.exit(1);
});
