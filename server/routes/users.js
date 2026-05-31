const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb , normalizeId } = require('../database');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const { formatters, validators, errorMessages } = require('../utils/validators');
const { getRDDateString, getRDDate } = require('../utils/timezone');


const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const usuarios = await db.collection('usuarios').find({
            negocio_id: normalizeId(req.session.negocioId)
        }).sort({ fecha_creacion: -1 }).toArray();

        res.json(usuarios.map(u => ({ ...u, id: u._id.toString() })));
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const usuario = await db.collection('usuarios').findOne({
            _id: normalizeId(req.params.id),
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ ...usuario, id: usuario._id.toString() });
    } catch (error) {
        console.error('Error al obtener usuario:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
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
            return res.status(403).json({ error: 'Solo el administrador del sistema puede crear admins' });
        }
        
        if (rol === 'empleado') {
            const db = getDb();
            
            const employeeCount = await db.collection('usuarios').countDocuments({
                negocio_id: normalizeId(req.session.negocioId),
                rol: 'empleado'
            });
            
            if (employeeCount >= 3) {
                return res.status(403).json({ error: 'Solo puedes crear máximo 3 empleados' });
            }
        }

        if (!['admin', 'empleado'].includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }

        const nombreNormalizado = formatters.toTitleCase(nombre.trim());
        const emailNormalizado = email.toLowerCase().trim();

        if (nombreNormalizado.length > 100) {
            return res.status(400).json({ error: 'El nombre no puede exceder 100 caracteres' });
        }

        const db = getDb();
        
        const existingUser = await db.collection('usuarios').findOne({ email: emailNormalizado });
        if (existingUser) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await db.collection('usuarios').insertOne({
            negocio_id: normalizeId(req.session.negocioId),
            nombre: nombreNormalizado,
            email: emailNormalizado,
            password: hashedPassword,
            rol,
            horario_tipo: horario_tipo || 'completo',
            hora_entrada: hora_entrada || '08:00',
            hora_salida: hora_salida || '18:00',
            comision_porcentaje: parseFloat(req.body.comision_porcentaje) || 0,
            estado: 'activo',
            fecha_creacion: new Date()
        });

        const usuario = await db.collection('usuarios').findOne({ _id: result.insertedId });

        res.status(201).json({ ...usuario, id: usuario._id.toString() });
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
        const user = await db.collection('usuarios').findOne({ _id: req.session.userId });
        
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
        await db.collection('usuarios').updateOne(
            { _id: user._id },
            { $set: { password: hashedPassword } }
        );
        
        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error al cambiar contraseña' });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        let { nombre, email, rol, estado, password, horario_tipo, hora_entrada, hora_salida } = req.body;
        const usuarioId = normalizeId(req.params.id);

        if (nombre) {
            nombre = formatters.toTitleCase(nombre.trim());
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
        
        const usuario = await db.collection('usuarios').findOne({
            _id: usuarioId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const isSelf = usuarioId === req.session.userId;

        if (rol && rol === 'admin' && !isSelf) {
            return res.status(403).json({ error: 'No puedes cambiar el rol a administrador' });
        }

        if (email) {
            const existingUser = await db.collection('usuarios').findOne({
                email,
                _id: { $ne: usuarioId }
            });
            if (existingUser) {
                return res.status(400).json({ error: 'El email ya está en uso' });
            }
        }

        let updates = {};
        
        if (nombre) {
            updates.nombre = nombre;
        }
        if (email) {
            updates.email = email;
        }
        if (rol && ['admin', 'empleado'].includes(rol)) {
            updates.rol = rol;
        }
        if (estado && ['activo', 'inactivo'].includes(estado)) {
            updates.estado = estado;
        }
        if (password) {
            updates.password = bcrypt.hashSync(password, 10);
        }
        if (horario_tipo) {
            updates.horario_tipo = horario_tipo;
        }
        if (hora_entrada) {
            updates.hora_entrada = hora_entrada;
        }
        if (hora_salida) {
            updates.hora_salida = hora_salida;
        }
        if (req.body.comision_porcentaje !== undefined) {
            updates.comision_porcentaje = parseFloat(req.body.comision_porcentaje) || 0;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('usuarios').updateOne(
            { _id: usuarioId, negocio_id: normalizeId(req.session.negocioId) },
            { $set: updates }
        );

        const updatedUser = await db.collection('usuarios').findOne({
            _id: usuarioId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        res.json({ ...updatedUser, id: updatedUser._id.toString() });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const usuarioId = normalizeId(req.params.id);
        const db = getDb();

        const usuario = await db.collection('usuarios').findOne({
            _id: usuarioId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const isSelf = usuarioId === req.session.userId;

        if (!isSelf) {
            const session = await db.startSession();
            await session.withTransaction(async () => {
                await db.collection('usuarios').deleteOne({
                    _id: usuarioId,
                    negocio_id: normalizeId(req.session.negocioId)
                });
            });
            await session.endSession();
            res.json({ success: true, message: 'Usuario eliminado' });
        } else {
            const otherAdmins = await db.collection('usuarios').countDocuments({
                negocio_id: normalizeId(req.session.negocioId),
                rol: 'admin',
                _id: { $ne: usuarioId }
            });

            if (otherAdmins === 0) {
                return res.status(400).json({ error: 'No puedes eliminarte, eres el único administrador' });
            }

            const session = await db.startSession();
            await session.withTransaction(async () => {
                await db.collection('usuarios').deleteOne({
                    _id: usuarioId,
                    negocio_id: normalizeId(req.session.negocioId)
                });
            });
            await session.endSession();
            res.json({ success: true, message: 'Usuario eliminado' });
        }
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

router.post('/:id/reactivate', requireAdmin, async (req, res) => {
    try {
        const usuarioId = normalizeId(req.params.id);
        const db = getDb();

        const usuario = await db.collection('usuarios').findOne({
            _id: usuarioId,
            negocio_id: normalizeId(req.session.negocioId)
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        await db.collection('usuarios').updateOne(
            { _id: usuarioId },
            { $set: { last_login: getRDDate().toISOString(), estado: 'activo' } }
        );

        res.json({ success: true, message: 'Usuario reactivado correctamente' });
    } catch (error) {
        console.error('Error al reactivar usuario:', error);
        res.status(500).json({ error: 'Error al reactivar usuario' });
    }
});

module.exports = router;
