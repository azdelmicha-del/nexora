const express = require('express');
const { getDb } = require('../database');
const { autoBackup } = require('../backup-protection');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Middleware: solo superadmin autenticado
function requireDebugAuth(req, res, next) {
    if (!req.session.superAdminId) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// Endpoint para verificar datos
router.get('/debug/data', requireDebugAuth, (req, res) => {
    try {
        const db = getDb();
        
        const negocios = db.prepare('SELECT COUNT(*) as count FROM negocios').get().count;
        const ventas = db.prepare('SELECT COUNT(*) as count FROM ventas').get().count;
        const citas = db.prepare('SELECT COUNT(*) as count FROM citas').get().count;
        const clientes = db.prepare('SELECT COUNT(*) as count FROM clientes').get().count;
        const usuarios = db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count;
        
        res.json({
            negocios,
            usuarios,
            ventas,
            citas,
            clientes,
            message: 'Datos en BD'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de diagnóstico de login
router.post('/debug/login-test', requireDebugAuth, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email requerido' });
        
        const db = getDb();
        const emailLower = email.toLowerCase().trim();
        
        const user = db.prepare(`
            SELECT u.id, u.nombre, u.email, u.password, u.rol, u.negocio_id, u.estado,
                   n.estado as negocio_estado, n.nombre as negocio_nombre
            FROM usuarios u
            JOIN negocios n ON u.negocio_id = n.id
            WHERE u.email = ?
        `).get(emailLower);
        
        if (!user) {
            // Buscar con email exacto como se envió
            const userRaw = db.prepare(`
                SELECT u.id, u.email FROM usuarios u WHERE u.email = ?
            `).get(email);
            
            return res.json({
                found: false,
                searched: emailLower,
                searchedRaw: email,
                foundRaw: userRaw ? { id: userRaw.id, email: userRaw.email } : null,
                hint: 'Usuario no encontrado. Verificar si el email está en lowercase en la BD'
            });
        }
        
        // Probar con la contraseña que se envió
        const password = req.body.password;
        let passwordMatch = null;
        if (password) {
            passwordMatch = await bcrypt.compare(password, user.password);
        }
        
        res.json({
            found: true,
            user: {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol,
                estado: user.estado,
                negocio_id: user.negocio_id,
                negocio_nombre: user.negocio_nombre,
                negocio_estado: user.negocio_estado
            },
            emailSent: email,
            emailSearched: emailLower,
            emailInDB: user.email,
            emailMatch: emailLower === user.email,
            passwordProvided: !!password,
            passwordMatch: passwordMatch,
            passwordHashPrefix: user.password.substring(0, 20) + '...'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para ver info del entorno
router.get('/debug/env', requireDebugAuth, (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const dbDir = process.env.DB_DIR || path.join(__dirname, '..', 'db');
        const dbPath = path.join(dbDir, 'nexora.db');
        
        res.json({
            DB_DIR: dbDir,
            DB_PATH: dbPath,
            DB_EXISTS: fs.existsSync(dbPath),
            DB_SIZE: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
            NODE_ENV: process.env.NODE_ENV,
            TZ: process.env.TZ || 'not set',
            PORT: process.env.PORT || 'not set',
            SESSION_SECRET_SET: !!process.env.SESSION_SECRET,
            OLD_DB_PATH: path.join(__dirname, '..', 'db', 'nexora.db'),
            OLD_DB_EXISTS: fs.existsSync(path.join(__dirname, '..', 'db', 'nexora.db'))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para hacer backup manual
router.post('/debug/backup', requireDebugAuth, (req, res) => {
    try {
        const backupPath = autoBackup();
        if (backupPath) {
            res.json({ success: true, message: 'Backup creado exitosamente' });
        } else {
            res.status(500).json({ error: 'Error al crear backup' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
