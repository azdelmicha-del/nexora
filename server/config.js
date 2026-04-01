require('dotenv').config();

const config = {
    LICENSE_MASTER_KEY: process.env.LICENSE_MASTER_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development'
};

if (!config.LICENSE_MASTER_KEY) {
    console.error('⚠️  LICENSE_MASTER_KEY no configurada en .env');
    console.error('   Copia .env.example a .env y configura las variables.');
}

if (!config.SESSION_SECRET) {
    console.error('⚠️  SESSION_SECRET no configurada en .env');
    console.error('   Copia .env.example a .env y configura las variables.');
}

module.exports = config;
