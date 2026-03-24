const { getDb } = require('./database');
const bcrypt = require('bcryptjs');

function resetMainUserPassword() {
    console.log('Reseteando contraseña del usuario principal...');
    
    const db = getDb();
    
    // Verificar si el usuario existe
    const user = db.prepare('SELECT id, email FROM usuarios WHERE email = ?').get('azdelmicha@gmail.com');
    
    if (!user) {
        console.log('Usuario azdelmicha@gmail.com no encontrado');
        return;
    }
    
    // SIEMPRE actualizar contraseña (forzar reset)
    const newHash = bcrypt.hashSync('Admin2026!', 10);
    db.prepare('UPDATE usuarios SET password = ? WHERE email = ?').run(newHash, 'azdelmicha@gmail.com');
    
    console.log('✅ Contraseña actualizada para azdelmicha@gmail.com');
    console.log('   Email: azdelmicha@gmail.com');
    console.log('   Contraseña: Admin2026!');
}

module.exports = { resetMainUserPassword };
