const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();

function toTitleCase(str) {
    return String(str).toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const usuarios = db.prepare(`
            SELECT id, negocio_id, nombre, email, rol, estado, horario_tipo, hora_entrada, hora_salida, fecha_creacion
            FROM usuarios
            WHERE negocio_id = ?
            ORDER BY fecha_creacion DESC
        `).all(req.session.negocioId);

        res.json(usuarios);
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const usuario = db.prepare(`
            SELECT id, negocio_id, nombre, email, rol, estado, horario_tipo, hora_entrada, hora_salida, fecha_creacion
            FROM usuarios
            WHERE id = ? AND negocio_id = ?
        `).get(req.params.id, req.session.negocioId);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json(usuario);
    } catch (error) {
        console.error('Error al obtener usuario:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { nombre, email, password, rol, horario_tipo, hora_entrada, hora_salida } = req.body;
        
        if (!nombre || !email || !password || !rol) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Email inválido' });
        }

        if (rol === 'admin') {
            if (req.session.email !== 'azdelmicha@gmail.com') {
                return res.status(403).json({ error: 'Solo el administrador principal puede crear admins' });
            }
        }
        
        if (rol === 'empleado') {
            const db = getDb();
            
            if (req.session.email !== 'azdelmicha@gmail.com') {
                const employeeCount = db.prepare(`
                    SELECT COUNT(*) as count FROM usuarios 
                    WHERE negocio_id = ? AND rol = 'empleado'
                `).get(req.session.negocioId);
                
                if (employeeCount.count >= 3) {
                    return res.status(403).json({ error: 'Solo puedes crear máximo 3 empleados' });
                }
            }
        }

        if (!['admin', 'empleado'].includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }

        const nombreNormalizado = toTitleCase(nombre.trim());
        const emailNormalizado = email.toLowerCase().trim();

        if (nombreNormalizado.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        const db = getDb();
        
        const existingUser = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(emailNormalizado);
        if (existingUser) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(`
            INSERT INTO usuarios (negocio_id, nombre, email, password, rol, horario_tipo, hora_entrada, hora_salida)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.session.negocioId, nombreNormalizado, emailNormalizado, hashedPassword, rol, horario_tipo || 'completo', hora_entrada || '08:00', hora_salida || '18:00');

        const usuario = db.prepare(`
            SELECT id, negocio_id, nombre, email, rol, estado, horario_tipo, hora_entrada, hora_salida, fecha_creacion
            FROM usuarios WHERE id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json(usuario);
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// Cambiar contraseña propia
router.put('/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }
        
        const db = getDb();
        
        // Obtener usuario actual
        const user = db.prepare('SELECT id, password FROM usuarios WHERE id = ?').get(req.session.userId);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar contraseña actual
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }
        
        // Actualizar contraseña
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashedPassword, user.id);
        
        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        let { nombre, email, rol, estado, password, horario_tipo, hora_entrada, hora_salida } = req.body;
        const usuarioId = req.params.id;

        if (nombre) {
            nombre = toTitleCase(nombre.trim());
        }
        if (email) {
            email = email.toLowerCase().trim();
        }

        if (nombre && nombre.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: 'Email inválido' });
            }
        }

        if (rol && !['admin', 'empleado'].includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }

        if (password && password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const db = getDb();
        
        const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ? AND negocio_id = ?')
            .get(usuarioId, req.session.negocioId);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const isSelf = parseInt(usuarioId) === req.session.userId;

        if (rol && rol === 'admin' && !isSelf) {
            return res.status(403).json({ error: 'No puedes cambiar el rol a administrador' });
        }

        if (email) {
            const existingUser = db.prepare('SELECT id FROM usuarios WHERE email = ? AND id != ?')
                .get(email, usuarioId);
            if (existingUser) {
                return res.status(400).json({ error: 'El email ya está en uso' });
            }
        }

        let updates = [];
        let params = [];
        
        if (nombre) {
            updates.push('nombre = ?');
            params.push(nombre);
        }
        if (email) {
            updates.push('email = ?');
            params.push(email);
        }
        if (rol && ['admin', 'empleado'].includes(rol)) {
            updates.push('rol = ?');
            params.push(rol);
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.push('estado = ?');
            params.push(estado);
        }
        if (password) {
            const hashedPassword = bcrypt.hashSync(password, 10);
            updates.push('password = ?');
            params.push(hashedPassword);
        }
        if (horario_tipo) {
            updates.push('horario_tipo = ?');
            params.push(horario_tipo);
        }
        if (hora_entrada) {
            updates.push('hora_entrada = ?');
            params.push(hora_entrada);
        }
        if (hora_salida) {
            updates.push('hora_salida = ?');
            params.push(hora_salida);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        params.push(usuarioId);
        db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        const updatedUser = db.prepare(`
            SELECT id, negocio_id, nombre, email, rol, estado, horario_tipo, hora_entrada, hora_salida, fecha_creacion
            FROM usuarios WHERE id = ?
        `).get(usuarioId);

        res.json(updatedUser);
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

router.delete('/:id', requireAdmin, (req, res) => {
    try {
        const usuarioId = req.params.id;
        const db = getDb();

        const usuario = db.prepare('SELECT id, rol FROM usuarios WHERE id = ? AND negocio_id = ?')
            .get(usuarioId, req.session.negocioId);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const isSelf = parseInt(usuarioId) === req.session.userId;

        if (!isSelf) {
            db.prepare('DELETE FROM usuarios WHERE id = ?').run(usuarioId);
            res.json({ success: true, message: 'Usuario eliminado' });
        } else {
            const otherAdmins = db.prepare(`
                SELECT COUNT(*) as count FROM usuarios 
                WHERE negocio_id = ? AND rol = 'admin' AND id != ?
            `).get(req.session.negocioId, usuarioId);

            if (otherAdmins.count === 0) {
                return res.status(400).json({ error: 'No puedes eliminarte, eres el único administrador' });
            }

            db.prepare('DELETE FROM usuarios WHERE id = ?').run(usuarioId);
            res.json({ success: true, message: 'Usuario eliminado' });
        }
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

router.post('/:id/reactivate', requireAdmin, (req, res) => {
    try {
        const usuarioId = req.params.id;
        const db = getDb();

        const usuario = db.prepare('SELECT id FROM usuarios WHERE id = ? AND negocio_id = ?')
            .get(usuarioId, req.session.negocioId);

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        db.prepare('UPDATE usuarios SET last_login = ?, estado = ? WHERE id = ?')
            .run(new Date().toISOString(), 'activo', usuarioId);

        res.json({ success: true, message: 'Usuario reactivado correctamente' });
    } catch (error) {
        console.error('Error al reactivar usuario:', error);
        res.status(500).json({ error: 'Error al reactivar usuario' });
    }
});

module.exports = router;
