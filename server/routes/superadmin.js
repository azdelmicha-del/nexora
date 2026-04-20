const express = require('express');
const { getDb } = require('../database');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { LICENSE_MASTER_KEY } = require('../config');
const { getRDDateString, getRDDate } = require('../utils/timezone');

const router = express.Router();

// Middleware para verificar super admin (acepta sesión O MASTER_KEY)
function requireSuperAdmin(req, res, next) {
    const masterKey = req.headers['x-master-key'];
    if (masterKey === LICENSE_MASTER_KEY) {
        return next();
    }
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
                login_attempts INTEGER DEFAULT 0,
                last_attempt TEXT,
                fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Migrar columnas si la tabla ya existía sin ellas
        const saColumns = db.prepare("PRAGMA table_info(super_admins)").all();
        if (!saColumns.some(c => c.name === 'login_attempts')) {
            db.exec('ALTER TABLE super_admins ADD COLUMN login_attempts INTEGER DEFAULT 0');
        }
        if (!saColumns.some(c => c.name === 'last_attempt')) {
            db.exec('ALTER TABLE super_admins ADD COLUMN last_attempt TEXT');
        }
        
        // Seed: crear superadmin por defecto si no existe ninguno
        const superAdminCount = db.prepare('SELECT COUNT(*) as count FROM super_admins').get().count;
        if (superAdminCount === 0) {
            const hashedPassword = bcrypt.hashSync('Admin20261', 10);
            db.prepare('INSERT INTO super_admins (email, password, nombre) VALUES (?, ?, ?)')
                .run('azdelmicha@gmail.com', hashedPassword, 'Administrador');
        }
        
        const admin = db.prepare('SELECT * FROM super_admins WHERE email = ? AND estado = ?').get(email, 'activo');
        
        if (!admin) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        
        // Verificar bloqueo por intentos fallidos
        const MAX_ATTEMPTS = 3;
        const LOCKOUT_MINUTES = 15;
        
        if (admin.login_attempts >= MAX_ATTEMPTS && admin.last_attempt) {
            const lastAttempt = new Date(admin.last_attempt);
            const minutesSince = (getRDDate() - lastAttempt) / (1000 * 60);
            
            if (minutesSince < LOCKOUT_MINUTES) {
                const minutesRemaining = Math.ceil(LOCKOUT_MINUTES - minutesSince);
                return res.status(429).json({
                    error: 'account_locked',
                    message: `Cuenta bloqueada. Intenta de nuevo en ${minutesRemaining} minutos.`,
                    minutesRemaining: minutesRemaining,
                    locked: true
                });
            } else {
                db.prepare('UPDATE super_admins SET login_attempts = 0, last_attempt = NULL WHERE id = ?').run(admin.id);
                admin.login_attempts = 0;
            }
        }
        
        const validPassword = bcrypt.compareSync(password, admin.password);
        if (!validPassword) {
            const newAttempts = (admin.login_attempts || 0) + 1;
            db.prepare('UPDATE super_admins SET login_attempts = ?, last_attempt = ? WHERE id = ?')
                .run(newAttempts, getRDDate().toISOString(), admin.id);
            
            if (newAttempts >= MAX_ATTEMPTS) {
                return res.status(429).json({
                    error: 'account_locked',
                    message: `Cuenta bloqueada. Intenta de nuevo en ${LOCKOUT_MINUTES} minutos.`,
                    minutesRemaining: LOCKOUT_MINUTES,
                    locked: true
                });
            }
            
            return res.status(401).json({
                error: 'Credenciales incorrectas',
                attemptsRemaining: MAX_ATTEMPTS - newAttempts
            });
        }
        
        // Resetear intentos en login exitoso
        db.prepare('UPDATE super_admins SET login_attempts = 0, last_attempt = NULL WHERE id = ?').run(admin.id);
        
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

// Desbloquear cuenta con código de seguridad
router.post('/unlock', (req, res) => {
    try {
        const { email, security_code } = req.body;
        
        if (!email || !security_code) {
            return res.status(400).json({ error: 'Email y código de seguridad requeridos' });
        }
        
        const UNLOCK_CODE = process.env.SUPERADMIN_UNLOCK_CODE || '7916';
        if (security_code !== UNLOCK_CODE) {
            return res.status(401).json({ error: 'Código de seguridad incorrecto' });
        }
        
        const db = getDb();
        const admin = db.prepare('SELECT id FROM super_admins WHERE email = ? AND estado = ?').get(email, 'activo');
        
        if (!admin) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }
        
        db.prepare('UPDATE super_admins SET login_attempts = 0, last_attempt = NULL WHERE id = ?').run(admin.id);
        
        res.json({ success: true, message: 'Cuenta desbloqueada. Puede iniciar sesión ahora.' });
    } catch (error) {
        console.error('Error en unlock super admin:', error);
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
        const totalCitas = db.prepare('SELECT COUNT(*) as count FROM citas WHERE negocio_id = ?').get(req.params.id).count;
        const totalVentas = db.prepare('SELECT COUNT(*) as count FROM ventas WHERE negocio_id = ?').get(req.params.id).count;
        
        res.json({ 
            negocio, 
            usuarios,
            stats: {
                totalUsuarios: usuarios.length,
                totalCitas,
                totalVentas
            }
        });
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
        const negocioId = parseInt(req.params.id);
        
        // Check if already soft-deleted
        const negocio = db.prepare('SELECT id, estado FROM negocios WHERE id = ?').get(negocioId);
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        if (negocio.estado === 'eliminado') {
            // Hard delete - remove permanently
            // Disable foreign keys temporarily to avoid constraint issues
            db.exec('PRAGMA foreign_keys = OFF');
            db.prepare('DELETE FROM log_auditoria WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM notificaciones WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM movimientos_inventario WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM chatbot_mensajes WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM chatbot_reglas WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM whatsapp_config WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM horario_negocio WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM sucursales WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM certificados_dgii WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM secuencias_ncf WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM config WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM conversaciones WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM puntos_lealtad WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM historial_puntos WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM comisiones WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM venta_detalles WHERE venta_id IN (SELECT id FROM ventas WHERE negocio_id = ?)').run(negocioId);
            db.prepare('DELETE FROM ventas WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM notas_credito WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM pedidos_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE negocio_id = ?)').run(negocioId);
            db.prepare('DELETE FROM pedidos WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM menu_items WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM menu_categorias WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM productos WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM estado_resultado_items WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM citas WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM clientes WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM servicios WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM categorias WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM cajas_cerradas WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM usuarios WHERE negocio_id = ?').run(negocioId);
            db.prepare('DELETE FROM negocios WHERE id = ?').run(negocioId);
            db.exec('PRAGMA foreign_keys = ON');
            
            res.json({ success: true, message: 'Negocio eliminado permanentemente' });
        } else {
            // Soft delete - mark as eliminated
            db.prepare('UPDATE negocios SET estado = ? WHERE id = ?').run('eliminado', negocioId);
            db.prepare('UPDATE usuarios SET estado = ? WHERE negocio_id = ?').run('inactivo', negocioId);
            
            res.json({ success: true, message: 'Negocio marcado como eliminado' });
        }
    } catch (error) {
        console.error('Error eliminando negocio:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
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
        const fechaInicio = getRDDate().toISOString();
        const fechaExpiracion = getRDDate();
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

// Setear días restantes de trial para testing
router.put('/negocios/:id/trial-days', requireSuperAdmin, (req, res) => {
    try {
        const { dias_restantes } = req.body;
        
        if (dias_restantes === undefined || dias_restantes < 0 || dias_restantes > 365) {
            return res.status(400).json({ error: 'Días inválidos (0-365)' });
        }
        
        const db = getDb();
        const negocio = db.prepare('SELECT id, nombre FROM negocios WHERE id = ?').get(req.params.id);
        
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        // Calcular fecha de inicio para que queden exactamente X días (trial = 7 días)
        const TRIAL_DAYS = 7;
        const diasUsados = TRIAL_DAYS - dias_restantes;
        const fechaInicio = getRDDate();
        fechaInicio.setDate(fechaInicio.getDate() - diasUsados);
        
        db.prepare(`
            UPDATE negocios 
            SET licencia_plan = 'trial',
                licencia_fecha_inicio = ?,
                licencia_fecha_expiracion = NULL
            WHERE id = ?
        `).run(fechaInicio.toISOString(), req.params.id);
        
        res.json({ 
            success: true, 
            message: `Trial de "${negocio.nombre}" ajustado a ${dias_restantes} días restantes` 
        });
    } catch (error) {
        console.error('Error seteando trial:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Resetear contraseña de admin de un negocio
router.post('/negocios/:id/reset-password', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.params.id;

        const negocio = db.prepare('SELECT id, nombre FROM negocios WHERE id = ?').get(negocioId);
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        const admin = db.prepare("SELECT id, nombre, email FROM usuarios WHERE negocio_id = ? AND rol = 'admin'").get(negocioId);
        if (!admin) {
            return res.status(404).json({ error: 'No se encontró administrador para este negocio' });
        }

        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let tempPassword = 'Temp';
        for (let i = 0; i < 6; i++) {
            tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        tempPassword += '!';

        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashedPassword, admin.id);

        res.json({
            success: true,
            message: 'Contraseña reseteada correctamente',
            negocio: negocio.nombre,
            usuario: {
                nombre: admin.nombre,
                email: admin.email,
                contrasenaTemporal: tempPassword
            }
        });
    } catch (error) {
        console.error('Error reseteando contraseña:', error);
        res.status(500).json({ error: 'Error al resetear contraseña' });
    }
});

// Estadísticas generales
router.get('/stats', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        
        // Obtener tamaño de la base de datos
        const dbPath = path.join(__dirname, '..', 'db', 'nexora.db');
        let dbSizeBytes = 0;
        try {
            const stat = fs.statSync(dbPath);
            dbSizeBytes = stat.size;
        } catch (e) {
            // Fallback: usar page_count * page_size
            const pragma = db.prepare('PRAGMA page_count').get();
            const pageSize = db.prepare('PRAGMA page_size').get();
            if (pragma && pageSize) {
                dbSizeBytes = pragma.page_count * pageSize.page_size;
            }
        }
        
        const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);
        const maxSizeGB = 1; // Límite práctico de SQLite
        const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;
        const porcentajeUso = ((dbSizeBytes / maxSizeBytes) * 100).toFixed(2);
        
        // Obtener tamaño de imágenes (texto base64 en servicios)
        const imagenesSize = db.prepare(`
            SELECT COALESCE(SUM(LENGTH(imagen)), 0) as total
            FROM servicios WHERE imagen IS NOT NULL AND imagen != ''
        `).get();
        
        const imagenesMB = (imagenesSize.total / (1024 * 1024)).toFixed(2);
        
        const stats = {
            totalNegocios: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado != ?').get('eliminado').count,
            negociosActivos: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado = ?').get('activo').count,
            negociosSuspendidos: db.prepare('SELECT COUNT(*) as count FROM negocios WHERE estado = ?').get('suspendido').count,
            totalUsuarios: db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count,
            totalCitas: db.prepare('SELECT COUNT(*) as count FROM citas').get().count,
            totalVentas: db.prepare('SELECT COUNT(*) as count FROM ventas').get().count,
            almacenamiento: {
                totalMB: parseFloat(dbSizeMB),
                porcentaje: parseFloat(porcentajeUso),
                limiteGB: maxSizeGB,
                imagenesMB: parseFloat(imagenesMB)
            }
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cambiar contraseña del super admin (movida antes de module.exports — fix de codigo muerto)
router.post('/change-password', requireSuperAdmin, (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        const db = getDb();
        const admin = db.prepare('SELECT * FROM super_admins WHERE id = ?').get(req.session.superAdminId);

        if (!admin) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }

        const validPassword = bcrypt.compareSync(current_password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }

        const hashedPassword = bcrypt.hashSync(new_password, 10);
        db.prepare('UPDATE super_admins SET password = ? WHERE id = ?').run(hashedPassword, admin.id);

        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// GET platform config
router.get('/platform-config', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        const cfg = db.prepare('SELECT * FROM platform_config WHERE id = 1').get();
        res.json(cfg || {});
    } catch (error) {
        console.error('Error obteniendo platform_config:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// PUT platform config
router.put('/platform-config', requireSuperAdmin, (req, res) => {
    try {
        const { system_name, version, edition, copyright_year, show_footer, custom_text } = req.body;
        const db = getDb();
        db.prepare(`
            UPDATE platform_config SET
                system_name = ?,
                version = ?,
                edition = ?,
                copyright_year = ?,
                show_footer = ?,
                custom_text = ?
            WHERE id = 1
        `).run(
            String(system_name || 'Nexora').trim(),
            String(version || '1.0.0').trim(),
            String(edition || 'Pro').trim(),
            parseInt(copyright_year) || new Date().getFullYear(),
            show_footer ? 1 : 0,
            String(custom_text || '').trim()
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando platform_config:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
