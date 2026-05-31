const express = require('express');
const { getDb , normalizeId } = require('../database');
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
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña requeridos' });
        }
        
        const db = getDb();
        
        // Seed: crear superadmin por defecto si no existe ninguno
        const superAdminCount = await db.collection('super_admins').countDocuments();
        if (superAdminCount === 0) {
            const hashedPassword = bcrypt.hashSync('Admin20261', 10);
            await db.collection('super_admins').insertOne({
                email: 'azdelmicha@gmail.com',
                password: hashedPassword,
                nombre: 'Administrador',
                estado: 'activo',
                login_attempts: 0,
                last_attempt: null,
                fecha_creacion: new Date().toISOString()
            });
        }
        
        const admin = await db.collection('super_admins').findOne({ email, estado: 'activo' });
        
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
                await db.collection('super_admins').updateOne(
                    { _id: admin._id },
                    { $set: { login_attempts: 0, last_attempt: null } }
                );
                admin.login_attempts = 0;
            }
        }
        
        const validPassword = bcrypt.compareSync(password, admin.password);
        if (!validPassword) {
            const newAttempts = (admin.login_attempts || 0) + 1;
            await db.collection('super_admins').updateOne(
                { _id: admin._id },
                { $set: { login_attempts: newAttempts, last_attempt: getRDDate().toISOString() } }
            );
            
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
        await db.collection('super_admins').updateOne(
            { _id: admin._id },
            { $set: { login_attempts: 0, last_attempt: null } }
        );
        
        req.session.superAdminId = admin._id.toString();
        req.session.superAdminEmail = admin.email;
        req.session.superAdminNombre = admin.nombre;
        
        res.json({
            success: true,
            admin: {
                id: admin._id.toString(),
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
router.post('/unlock', async (req, res) => {
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
        const admin = await db.collection('super_admins').findOne({ email, estado: 'activo' });
        
        if (!admin) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }
        
        await db.collection('super_admins').updateOne(
            { _id: admin._id },
            { $set: { login_attempts: 0, last_attempt: null } }
        );
        
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
router.get('/negocios', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        
        const negocios = await db.collection('negocios').find({}).sort({ fecha_registro: -1 }).toArray();
        
        // Get counts for each negocio
        for (const negocio of negocios) {
            negocio.id = negocio._id.toString();
            delete negocio._id;
            
            negocio.total_usuarios = await db.collection('usuarios').countDocuments({ negocio_id: negocio.id });
            negocio.total_citas = await db.collection('citas').countDocuments({ negocio_id: negocio.id });
            negocio.total_ventas = await db.collection('ventas').countDocuments({ negocio_id: negocio.id });
        }
        
        res.json(negocios);
    } catch (error) {
        console.error('Error obteniendo negocios:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Obtener un negocio específico
router.get('/negocios/:id', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.params.id) });
        
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        const negocioResponse = { ...negocio, id: negocio._id.toString() };
        delete negocioResponse._id;
        
        const usuarios = await db.collection('usuarios')
            .find({ negocio_id: normalizeId(req.params.id) })
            .project({ id: 1, nombre: 1, email: 1, rol: 1, estado: 1 })
            .toArray();
        
        const usuariosWithId = usuarios.map(u => ({ ...u, id: u._id.toString(), _id: undefined }));
        
        const totalCitas = await db.collection('citas').countDocuments({ negocio_id: normalizeId(req.params.id) });
        const totalVentas = await db.collection('ventas').countDocuments({ negocio_id: normalizeId(req.params.id) });
        
        res.json({ 
            negocio: negocioResponse, 
            usuarios: usuariosWithId,
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
router.put('/negocios/:id/estado', requireSuperAdmin, async (req, res) => {
    try {
        const { estado } = req.body;
        
        if (!['activo', 'suspendido', 'eliminado'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }
        
        const db = getDb();
        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.params.id) },
            { $set: { estado } }
        );
        
        res.json({ success: true, message: `Negocio ${estado}` });
    } catch (error) {
        console.error('Error actualizando estado:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Eliminar negocio (soft delete)
router.delete('/negocios/:id', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.params.id);
        
        // Check if already soft-deleted
        const negocio = await db.collection('negocios').findOne({ _id: negocioId });
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        if (negocio.estado === 'eliminado') {
            // Hard delete
            await db.collection('log_auditoria').deleteMany({ negocio_id: negocioId });
            await db.collection('notificaciones').deleteMany({ negocio_id: negocioId });
            await db.collection('movimientos_inventario').deleteMany({ negocio_id: negocioId });
            await db.collection('chatbot_mensajes').deleteMany({ negocio_id: negocioId });
            await db.collection('chatbot_reglas').deleteMany({ negocio_id: negocioId });
            await db.collection('whatsapp_config').deleteMany({ negocio_id: negocioId });
            await db.collection('horario_negocio').deleteMany({ negocio_id: negocioId });
            await db.collection('sucursales').deleteMany({ negocio_id: negocioId });
            await db.collection('certificados_dgii').deleteMany({ negocio_id: negocioId });
            await db.collection('secuencias_ncf').deleteMany({ negocio_id: negocioId });
            await db.collection('config').deleteMany({ negocio_id: negocioId });
            await db.collection('conversaciones').deleteMany({ negocio_id: negocioId });
            await db.collection('puntos_lealtad').deleteMany({ negocio_id: negocioId });
            await db.collection('historial_puntos').deleteMany({ negocio_id: negocioId });
            await db.collection('comisiones').deleteMany({ negocio_id: negocioId });
            
            // Delete venta_detalles for ventas belonging to this negocio
            const ventas = await db.collection('ventas').find({ negocio_id: negocioId }).project({ _id: 1 }).toArray();
            const ventaIds = ventas.map(v => v._id.toString());
            if (ventaIds.length > 0) {
                await db.collection('venta_detalles').deleteMany({ venta_id: { $in: ventaIds } });
            }
            await db.collection('ventas').deleteMany({ negocio_id: negocioId });
            
            await db.collection('notas_credito').deleteMany({ negocio_id: negocioId });
            
            // Delete pedidos_items for pedidos belonging to this negocio
            const pedidos = await db.collection('pedidos').find({ negocio_id: negocioId }).project({ _id: 1 }).toArray();
            const pedidoIds = pedidos.map(p => p._id.toString());
            if (pedidoIds.length > 0) {
                await db.collection('pedidos_items').deleteMany({ pedido_id: { $in: pedidoIds } });
            }
            await db.collection('pedidos').deleteMany({ negocio_id: negocioId });
            
            await db.collection('menu_items').deleteMany({ negocio_id: negocioId });
            await db.collection('menu_categorias').deleteMany({ negocio_id: negocioId });
            await db.collection('productos').deleteMany({ negocio_id: negocioId });
            await db.collection('estado_resultado_items').deleteMany({ negocio_id: negocioId });
            await db.collection('citas').deleteMany({ negocio_id: negocioId });
            await db.collection('clientes').deleteMany({ negocio_id: negocioId });
            await db.collection('servicios').deleteMany({ negocio_id: negocioId });
            await db.collection('categorias').deleteMany({ negocio_id: negocioId });
            await db.collection('cajas_cerradas').deleteMany({ negocio_id: negocioId });
            await db.collection('usuarios').deleteMany({ negocio_id: negocioId });
            await db.collection('negocios').deleteOne({ _id: negocioId });
            
            res.json({ success: true, message: 'Negocio eliminado permanentemente' });
        } else {
            // Soft delete - mark as eliminated
            await db.collection('negocios').updateOne(
                { _id: negocioId },
                { $set: { estado: 'eliminado' } }
            );
            await db.collection('usuarios').updateMany(
                { negocio_id: negocioId },
                { $set: { estado: 'inactivo' } }
            );
            
            res.json({ success: true, message: 'Negocio marcado como eliminado' });
        }
    } catch (error) {
        console.error('Error eliminando negocio:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Activar licencia de negocio
router.put('/negocios/:id/licencia', requireSuperAdmin, async (req, res) => {
    try {
        const { plan, dias } = req.body;
        
        if (!['trial', 'monthly', 'semiannual', 'annual'].includes(plan)) {
            return res.status(400).json({ error: 'Plan inválido' });
        }
        
        const db = getDb();
        const fechaInicio = getRDDate().toISOString();
        const fechaExpiracion = getRDDate();
        fechaExpiracion.setDate(fechaExpiracion.getDate() + (dias || 30));
        
        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.params.id) },
            { $set: { 
                licencia_plan: plan, 
                licencia_fecha_inicio: fechaInicio, 
                licencia_fecha_expiracion: fechaExpiracion.toISOString(),
                estado: 'activo'
            }}
        );
        
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
router.put('/negocios/:id/trial-days', requireSuperAdmin, async (req, res) => {
    try {
        const { dias_restantes } = req.body;
        
        if (dias_restantes === undefined || dias_restantes < 0 || dias_restantes > 365) {
            return res.status(400).json({ error: 'Días inválidos (0-365)' });
        }
        
        const db = getDb();
        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.params.id) });
        
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }
        
        // Calcular fecha de inicio para que queden exactamente X días (trial = 7 días)
        const TRIAL_DAYS = 7;
        const diasUsados = TRIAL_DAYS - dias_restantes;
        const fechaInicio = getRDDate();
        fechaInicio.setDate(fechaInicio.getDate() - diasUsados);
        
        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.params.id) },
            { $set: { 
                licencia_plan: 'trial',
                licencia_fecha_inicio: fechaInicio.toISOString(),
                licencia_fecha_expiracion: null
            }}
        );
        
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
        const negocioId = normalizeId(req.params.id);

        const negocio = await db.collection('negocios').findOne({ _id: negocioId });
        if (!negocio) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        const admin = await db.collection('usuarios').findOne({ negocio_id: negocioId, rol: 'admin' });
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
        await db.collection('usuarios').updateOne(
            { _id: admin._id },
            { $set: { password: hashedPassword } }
        );

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
router.get('/stats', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        
        const stats = {
            totalNegocios: await db.collection('negocios').countDocuments({ estado: { $ne: 'eliminado' } }),
            negociosActivos: await db.collection('negocios').countDocuments({ estado: 'activo' }),
            negociosSuspendidos: await db.collection('negocios').countDocuments({ estado: 'suspendido' }),
            totalUsuarios: await db.collection('usuarios').countDocuments(),
            totalCitas: await db.collection('citas').countDocuments(),
            totalVentas: await db.collection('ventas').countDocuments(),
            almacenamiento: {
                totalMB: 0,
                porcentaje: 0,
                limiteGB: 1,
                imagenesMB: 0
            }
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Cambiar contraseña del super admin
router.post('/change-password', requireSuperAdmin, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        if (new_password.length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
        }

        const db = getDb();
        const admin = await db.collection('super_admins').findOne({ _id: req.session.superAdminId });

        if (!admin) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }

        const validPassword = bcrypt.compareSync(current_password, admin.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Contraseña actual incorrecta' });
        }

        const hashedPassword = bcrypt.hashSync(new_password, 10);
        await db.collection('super_admins').updateOne(
            { _id: admin._id },
            { $set: { password: hashedPassword } }
        );

        res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// GET platform config
router.get('/platform-config', requireSuperAdmin, async (req, res) => {
    try {
        const db = getDb();
        const cfg = await db.collection('platform_config').findOne({});
        res.json(cfg || {});
    } catch (error) {
        console.error('Error obteniendo platform_config:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// PUT platform config
router.put('/platform-config', requireSuperAdmin, async (req, res) => {
    try {
        const { system_name, version, edition, copyright_year, show_footer, custom_text } = req.body;
        const db = getDb();
        await db.collection('platform_config').updateOne(
            {},
            { $set: {
                system_name: String(system_name || 'Nexora').trim(),
                version: String(version || '1.0.0').trim(),
                edition: String(edition || 'Pro').trim(),
                copyright_year: parseInt(copyright_year) || new Date().getFullYear(),
                show_footer: show_footer ? true : false,
                custom_text: String(custom_text || '').trim()
            }},
            { upsert: true }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando platform_config:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

module.exports = router;
