const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./database');
const { sanitizeInput } = require('./middleware/sanitize');
const { initLicense, isLicenseValid } = require('./license');
const { iniciarRecordatoriosCitas } = require('./cron/recordatorios');
const { requireAuth, requireAdmin, requireActiveLicense } = require('./middleware/auth');
const config = require('./config');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const configRoutes = require('./routes/config');
const servicesRoutes = require('./routes/services');
const categoriesRoutes = require('./routes/categories');
const clientsRoutes = require('./routes/clients');
const salesRoutes = require('./routes/sales');
const appointmentsRoutes = require('./routes/appointments');
const reportsRoutes = require('./routes/reports');
const notificationsRoutes = require('./routes/notifications');
const licenseRoutes = require('./routes/license');
const publicRoutes = require('./routes/public');
const testDbRoutes = require('./routes/test-db');
const superAdminRoutes = require('./routes/superadmin');
const debugRoutes = require('./routes/debug');
const estadoResultadoRoutes = require('./routes/estado-resultado');
const detailsRoutes = require('./routes/details');
const productsRoutes = require('./routes/products');
const commissionsRoutes = require('./routes/commissions');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');
const backupRoutes = require('./routes/backup');
const notesRoutes = require('./routes/notes');
const loyaltyRoutes = require('./routes/loyalty');
const whatsappRoutes = require('./routes/whatsapp');
const menuRoutes = require('./routes/menu');
const pedidosRoutes = require('./routes/pedidos');

const crypto = require('crypto');

const app = express();
const PORT = config.PORT;

const SESSION_SECRET = config.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!config.SESSION_SECRET) {
    console.log('⚠️  SESSION_SECRET no configurado. Se generó uno aleatorio.');
} else {
    console.log('✅ SESSION_SECRET configurado correctamente.');
}

const dbDir = process.env.DB_DIR || path.join(__dirname, 'db');
const dbPath = path.join(dbDir, 'nexora.db');
const sessionDir = process.env.NODE_ENV === 'production' ? dbDir : path.join(__dirname, 'db');
const backupDir = process.env.BACKUP_DIR || path.join(dbDir, 'backups');

function logStorageRuntime() {
    const dbDirAbs = path.resolve(dbDir);
    const sessionDirAbs = path.resolve(sessionDir);
    const backupDirAbs = path.resolve(backupDir);
    const dbPathAbs = path.resolve(dbPath);

    const sessionAligned = sessionDirAbs === dbDirAbs || sessionDirAbs.startsWith(dbDirAbs + path.sep);
    const backupAligned = backupDirAbs === dbDirAbs || backupDirAbs.startsWith(dbDirAbs + path.sep);

    console.log('📦 Runtime storage paths');
    console.log('   DB_DIR:', dbDirAbs);
    console.log('   DB_PATH:', dbPathAbs);
    console.log('   SESSION_DIR:', sessionDirAbs);
    console.log('   BACKUP_DIR:', backupDirAbs);
    console.log('   DB_EXISTS:', fs.existsSync(dbPathAbs));

    if (process.env.NODE_ENV === 'production' && (!sessionAligned || !backupAligned)) {
        console.error('❌ Inconsistencia de almacenamiento: BD/Sesiones/Backups no están alineados');
        console.error('   sessionAligned:', sessionAligned, 'backupAligned:', backupAligned);
    } else {
        console.log('✅ Almacenamiento coherente: BD, sesiones y backups alineados');
    }
}

initDatabase();
initLicense();

// Backup automático al iniciar (protección de datos)
const { autoBackup, checkDatabaseIntegrity, getBackupDir } = require('./backup-protection');
if (path.resolve(getBackupDir()) !== path.resolve(backupDir)) {
    console.error('❌ Inconsistencia BACKUP_DIR detectada entre index y backup-protection');
    console.error('   index BACKUP_DIR:', backupDir);
    console.error('   backup-protection BACKUP_DIR:', getBackupDir());
}
logStorageRuntime();
checkDatabaseIntegrity();
autoBackup();

// Importar BD completa SOLO si está vacía (PROTECCIÓN: nunca elimina datos)
const { initFullDatabase } = require('./init-full-db');
initFullDatabase();

// init-production eliminado - se usa superadmin

// Reset-password eliminado - se usa superadmin

// Crear super administrador si no existe
const { createSuperAdmin } = require('./create-superadmin');
createSuperAdmin();

// ── Seguridad: cabeceras HTTP y rate-limiting ─────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // deshabilitado para permitir inline scripts del frontend
    crossOriginEmbedderPolicy: false
}));

// Rate-limit global: 300 req/min por IP (protege toda la API)
const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intenta en un momento.' }
});
app.use('/api', globalLimiter);

// Rate-limit estricto para autenticacion: 20 req/15min por IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/superadmin/login', authLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require('express-fileupload')({
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    abortOnLimit: true,
    responseOnLimit: 'Archivo demasiado grande (máximo 5MB)',
    createParentPath: true
}));
app.use(sanitizeInput);

// Trust proxy para detectar HTTPS correctamente en Render
// Sin esto, las cookies secure no se guardan detrás del load balancer
app.set('trust proxy', 1);

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: sessionDir
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', requireActiveLicense, usersRoutes);
app.use('/api/config', requireActiveLicense, configRoutes);
app.use('/api/services', requireActiveLicense, servicesRoutes);
app.use('/api/categories', requireActiveLicense, categoriesRoutes);
app.use('/api/clients', requireActiveLicense, clientsRoutes);
app.use('/api/sales', requireActiveLicense, salesRoutes);
app.use('/api/appointments', requireActiveLicense, appointmentsRoutes);
app.use('/api/reports', requireActiveLicense, reportsRoutes);
app.use('/api/notifications', requireActiveLicense, notificationsRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/estado-resultado', requireActiveLicense, estadoResultadoRoutes);
app.use('/api/products', requireActiveLicense, productsRoutes);
app.use('/api/commissions', requireActiveLicense, commissionsRoutes);
app.use('/api/dashboard', requireActiveLicense, dashboardRoutes);
app.use('/api/audit', requireActiveLicense, auditRoutes);
app.use('/api/backup', requireActiveLicense, backupRoutes);
app.use('/api/notes', requireActiveLicense, notesRoutes);
app.use('/api/loyalty', requireActiveLicense, loyaltyRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/menu', requireActiveLicense, menuRoutes);
app.use('/api/pedidos', pedidosRoutes);

// Rutas de debug y test: solo disponibles en desarrollo
if (process.env.NODE_ENV !== 'production') {
    app.use('/api', requireActiveLicense, testDbRoutes);
    app.use('/api', detailsRoutes);
    app.use('/api', debugRoutes);
    console.log('⚠️  Rutas de debug activas (solo para desarrollo)');
}

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/superadmin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'superadmin.html'));
});

app.get('/registro', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'registro.html'));
});

app.get('/dashboard', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/pos', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pos.html'));
});

app.get('/citas', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'citas.html'));
});

app.get('/calendario', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'calendario.html'));
});

app.get('/usuarios', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'usuarios.html'));
});

app.get('/servicios', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'servicios.html'));
});

app.get('/categorias', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'categorias.html'));
});

app.get('/estado-resultado', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'estado-resultado.html'));
});

app.get('/egresos', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'egresos.html'));
});

app.get('/inventario', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'inventario.html'));
});

app.get('/comisiones', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'comisiones.html'));
});

app.get('/notas', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'notas.html'));
});

app.get('/auditoria', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'auditoria.html'));
});

app.get('/backup', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'backup.html'));
});

app.get('/empleados-reporte', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'empleados-reporte.html'));
});

app.get('/menu', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'menu.html'));
});

app.get('/pedidos', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pedidos.html'));
});

app.get('/menu/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'menu-cliente.html'));
});

app.get('/clientes', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'clientes.html'));
});

app.get('/reportes', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'reportes.html'));
});

app.get('/configuracion', requireAuth, requireActiveLicense, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'configuracion.html'));
});

app.get('/actualizar', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'actualizar.html'));
});

app.get('/licencias', (req, res, next) => {
    if (req.session.userId || req.session.superAdminId) {
        return next();
    }
    res.redirect('/');
}, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'licencias.html'));
});

app.get('/booking/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'booking.html'));
});

app.get('/health', (req, res) => {
    const { getRDDate } = require('./utils/timezone');
    res.json({ status: 'ok', time: getRDDate().toISOString(), timezone: 'America/Santo_Domingo' });
});

app.listen(PORT, () => {
    console.log(`Nexora ejecutándose en puerto ${PORT}`);
    console.log(`Zona horaria: ${process.env.TZ || 'America/Santo_Domingo'} (UTC-4)`);
    console.log(`DB_DIR: ${process.env.DB_DIR || path.join(__dirname, 'db')}`);
    iniciarRecordatoriosCitas();
});
