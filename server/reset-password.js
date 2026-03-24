const { getDb } = require('./database');
const bcrypt = require('bcryptjs');

function resetMainUserPassword() {
    console.log('Verificando contraseña del usuario principal...');
    
    const db = getDb();
    
    // Verificar si el usuario existe
    const user = db.prepare('SELECT id, email, password FROM usuarios WHERE email = ?').get('azdelmicha@gmail.com');
    
    if (!user) {
        console.log('Usuario azdelmicha@gmail.com no encontrado');
        return;
    }
    
    // Verificar si la contraseña actual es correcta
    const isCorrect = bcrypt.compareSync('Admin2026!', user.password);
    
    if (isCorrect) {
        console.log('Contraseña ya es correcta');
        return;
    }
    
    // Actualizar contraseña
    const newHash = bcrypt.hashSync('Admin2026!', 10);
    db.prepare('UPDATE usuarios SET password = ? WHERE email = ?').run(newHash, 'azdelmicha@gmail.com');
    
    console.log('Contraseña actualizada para azdelmicha@gmail.com');
}

module.exports = { resetMainUserPassword };
