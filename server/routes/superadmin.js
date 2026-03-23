const express = require('express');
const { getDb } = require('../database');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Middleware para verificar super admin
function requireSuperAdmin(req, res, next) {
    if (!req.session.superAdminId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// Login de super admin
router.post('/login', (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }
        
        const db = getDb();
        
        // Crear tabla si no existe
        db.exec(`
            CREATE TABLE IF NOT EXISTS super_admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                nombre TEXT NOT NULL,
                estado TEXT DEFAULT 'activo',
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const admin = db.prepare('SELECT * FROM super_admins WHERE email = ? AND estado = ?').get(email, 'activo');
        
        if (!admin) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        
        const validPassword = bcrypt.compareSync(password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        
        req.session.superAdminId = admin.id;
        req.session.superAdminEmail = admin.email;
        req.session.superAdminNombre = admin.nombre;
        
        res.json({
            success: true,
            admin: {
                id: admin.id,
                email: admin.email,
                nombre: admin.nombre
            }
        });
    } catch (error) {
        console.error('Error en login super admin:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Verificar sesión
router.get('/session', (req, res) => {
    if (req.session.superAdminId) {
        res.json({
            authenticated: true,
            admin: {
                id: req.session.superAdminId,
                email: req.session.superAdminEmail,
                nombre: req.session.superAdminNombre
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Obtener todos los negocios
router.get('/negocios', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        
        const negocios = db.prepare(`
            SELECT n.*, 
                   (SELECT COUNT(*) FROM usuarios WHERE negocio_id = n.id) as total_usuarios,
                   (SELECT COUNT(*) FROM citas WHERE negocio_id = n.id) as total_citas,
                   (SELECT COUNT(*) FROM ventas WHERE negocio_id = n.id) as total_ventas
            FROM negocios n
            ORDER BY n.fecha_registro DESC
        `).all();
        
        res.json(negocios);
    } catch (error) {
        console.error('Error obteniendo negocios:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener un negocio específico
router.get('/negocios/:id', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT * FROM negocios WHERE id = ?').get(req.params.id);
        
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        const usuarios = db.prepare('SELECT id, nombre, email, rol, estado FROM usuarios WHERE negocio_id = ?').all(req.params.id);
        
        res.json({ negocio, usuarios });
    } catch (error) {
        console.error('Error obteniendo negocio:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Actualizar estado de negocio
router.put('/negocios/:id/estado', requireSuperAdmin, (req, res) => {
    try {
        const { estado } = req.body;
        
        if (!['activo', 'suspendido', 'eliminado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }
        
        const db = getDb();
        db.prepare('UPDATE negocios SET estado = ? WHERE id = ?').run(estado, req.params.id);
        
        res.json({ success: true, message: `Negocio ${estado}` });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar negocio (soft delete)
router.delete('/negocios/:id', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        
        // Soft delete - cambiar estado a eliminado
        db.prepare('UPDATE negocios SET estado = ? WHERE id = ?').run('eliminado', req.params.id);
        
        // Desactivar todos los usuarios del negocio
        db.prepare('UPDATE usuarios SET estado = ? WHERE negocio_id = ?').run('inactivo', req.params.id);
        
        res.json({ success: true, message: 'Negocio eliminado' });
    } catch (error) {
        console.error('Error eliminando negocio:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Activar licencia de negocio
router.put('/negocios/:id/licencia', requireSuperAdmin, (req, res) => {
    try {
        const { plan, dias } = req.body;
        
        if (!['trial', 'monthly', 'semiannual', 'annual'].includes(plan)) {
            return res.status(400).json({ error: 'Plan inválido' });
        }
        
        const db = getDb();
        const fechaInicio = new Date().toISOString();
        const fechaExpiracion = new Date();
        fechaExpiracion.setDate(fechaExpiracion.getDate() + (dias || 30));
        
        db.prepare(`
            UPDATE negocios 
            SET licencia_plan = ?, 
                licencia_fecha_inicio = ?, 
                licencia_fecha_expiracion = ?,
                estado = 'activo'
            WHERE id = ?
        `).run(plan, fechaInicio, fechaExpiracion.toISOString(), req.params.id);
        
        res.json({ 
            success: true, 
            message: `Licencia ${plan} activada por ${dias || 30} días` 
        });
    } catch (error) {
        console.error('Error activando licencia:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Estadísticas generales
router.get('/stats', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        
        const stats = {
            totalNegocios: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado != ?').get('eliminado').count,
            negociosActivos: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado = ?').get('activo').count,
            negociosSuspendidos: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado = ?').get('suspendido').count,
            totalUsuarios: db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count,
            totalCitas: db.prepare('SELECT COUNT(*) as count FROM citas').get().count,
            totalVentas: db.prepare('SELECT COUNT(*) as count FROM ventas').get().count
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
