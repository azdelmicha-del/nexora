const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'db', 'nexora.db');
const db = new Database(dbPath);

const passwordHash = bcrypt.hashSync('@Azd191516', 10);

const existingUser = db.prepare(`SELECT id FROM usuarios WHERE email = ?`).get('azdelmicha@gmail.com');

if (existingUser) {
    db.prepare(`UPDATE usuarios SET password = ?, rol = 'admin' WHERE email = ?`).run(passwordHash, 'azdelmicha@gmail.com');
    console.log('Usuario actualizado!');
} else {
    const negocio = db.prepare(`INSERT INTO negocios (nombre, telefono, email, estado) VALUES (?, ?, ?, ?)`).run('Mi Negocio', '809-000-0000', 'azdelmicha@gmail.com', 'activo');
    const negocioId = negocio.lastInsertRowid;
    db.prepare(`INSERT INTO usuarios (negocio_id, nombre, email, password, rol, estado) VALUES (?, ?, ?, ?, ?, ?)`).run(negocioId, 'Michael', 'azdelmicha@gmail.com', passwordHash, 'admin', 'activo');
    console.log('Usuario creado!');
}

console.log('Email: azdelmicha@gmail.com');
console.log('Contraseña: @Azd191516');
console.log('Rol: Admin');
