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
router.get('/debug/data', requireDebugAuth, async (req, res) => {
    try {
        const db = getDb();

        const negocios = await db.collection('negocios').countDocuments();
        const ventas = await db.collection('ventas').countDocuments();
        const citas = await db.collection('citas').countDocuments();
        const clientes = await db.collection('clientes').countDocuments();
        const usuarios = await db.collection('usuarios').countDocuments();

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

        const user = await db.collection('usuarios').aggregate([
            { $match: { email: emailLower } },
            {
                $lookup: {
                    from: 'negocios',
                    localField: 'negocio_id',
                    foreignField: '_id',
                    as: 'negocio'
                }
            },
            { $unwind: { path: '$negocio', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    nombre: 1,
                    email: 1,
                    password: 1,
                    rol: 1,
                    negocio_id: 1,
                    estado: 1,
                    negocio_estado: '$negocio.estado',
                    negocio_nombre: '$negocio.nombre'
                }
            }
        ]).next();

        if (!user) {
            const userRaw = await db.collection('usuarios').findOne({ email }, { projection: { _id: 1, email: 1 } });

            return res.json({
                found: false,
                searched: emailLower,
                searchedRaw: email,
                foundRaw: userRaw ? { id: userRaw._id.toString(), email: userRaw.email } : null,
                hint: 'Usuario no encontrado. Verificar si el email está en lowercase en la BD'
            });
        }

        const password = req.body.password;
        let passwordMatch = null;
        if (password) {
            passwordMatch = await bcrypt.compare(password, user.password);
        }

        res.json({
            found: true,
            user: {
                id: user._id.toString(),
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
router.get('/debug/env', requireDebugAuth, async (req, res) => {
    try {
        const db = getDb();
        const dbName = db.databaseName;

        res.json({
            DB_NAME: dbName,
            NODE_ENV: process.env.NODE_ENV,
            TZ: process.env.TZ || 'not set',
            PORT: process.env.PORT || 'not set',
            SESSION_SECRET_SET: !!process.env.SESSION_SECRET,
            MONGO_URI_SET: !!process.env.MONGO_URI
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para hacer backup manual
router.post('/debug/backup', requireDebugAuth, async (req, res) => {
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
