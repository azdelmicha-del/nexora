const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./database');
const { sanitizeInput } = require('./middleware/sanitize');
const { initLicense, isLicenseValid } = require('./license');
const { requireAuth, requireAdmin } = require('./middleware/auth');

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

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.log('⚠️  SESSION_SECRET no configurado. Se generó uno aleatorio.');
} else {
    console.log('✅ SESSION_SECRET configurado correctamente.');
}

initDatabase();
initLicense();

// Backup automático al iniciar (protección de datos)
const { autoBackup, checkDatabaseIntegrity } = require('./backup-protection');
checkDatabaseIntegrity();
autoBackup();

// Importar BD completa SOLO si está vacía (PROTECCIÓN: nunca elimina datos)
const { initFullDatabase } = require('./init-full-db');
initFullDatabase();

// Inicializar datos de producción (crea negocio y usuario admin si no existen)
const { initProductionData } = require('./init-production');
initProductionData();

// Resetear contraseña del usuario principal si es necesario
const { resetMainUserPassword } = require('./reset-password');
resetMainUserPassword();

// Crear super administrador si no existe
const { createSuperAdmin } = require('./create-superadmin');
createSuperAdmin();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeInput);

app.use(session({
    secret: SESSION_SECRET,
    resave: true,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        secure: false, // Render maneja SSL en el proxy
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/config', configRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/public', publicRoutes);
app.use('/api', testDbRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/estado-resultado', estadoResultadoRoutes);
app.use('/api', debugRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/superadmin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'superadmin.html'));
});

app.get('/registro', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'registro.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get('/pos', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pos.html'));
});

app.get('/citas', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'citas.html'));
});

app.get('/calendario', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'calendario.html'));
});

app.get('/usuarios', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'usuarios.html'));
});

app.get('/servicios', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'servicios.html'));
});

app.get('/categorias', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'categorias.html'));
});

app.get('/estado-resultado', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'estado-resultado.html'));
});

app.get('/egresos', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'egresos.html'));
});

app.get('/clientes', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'clientes.html'));
});

app.get('/reportes', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'reportes.html'));
});

app.get('/configuracion', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'configuracion.html'));
});

app.get('/actualizar', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'actualizar.html'));
});

app.get('/licencias', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'licencias.html'));
});

app.get('/booking/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'booking.html'));
});

app.listen(PORT, () => {
    console.log(`Nexora ejecutándose en http://localhost:${PORT}`);
});
