const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { getRDDate } = require('./utils/timezone');

const LICENSE_FILE = path.join(__dirname, '..', 'license.json'); // Eliminado soporte a instalable local
const KEYS_FILE = path.join(__dirname, '..', 'valid_keys.json');

const TRIAL_DAYS = 7;

const PLANS = {
    trial: { name: 'Prueba', days: 7, price: 0 },
    monthly: { name: 'Mensual', days: 30, price: 13 },
    semiannual: { name: '6 Meses', days: 180, price: 80 },
    annual: { name: 'Anual', days: 365, price: 167 }
};

function getLicense() {
    // Eliminado soporte a instalable local
    return null;
}

function saveLicense() {
    // Eliminado soporte a instalable local
    return false;
}

function getDaysRemaining() {
    // Eliminado soporte a instalable local
    return { valid: true, type: 'trial', daysRemaining: 7 };
}

function getDaysRemainingLocal() {
    // Eliminado soporte a instalable local
    return { valid: true, type: 'trial', daysRemaining: 7 };
}

function activateLicense(key, plan, negocioId = null) {
    if (negocioId) {
        return activateLicenseNegocio(key, plan, negocioId);
    }
    return { success: false, message: 'Negocio no especificado' };
}

function recordTrialStart() {
    // Eliminado soporte a instalable local
    return null;
}


function getMachineId() {
    try {
        // En producción (Render), usar un ID fijo basado en variable de entorno
        if (process.env.NODE_ENV === 'production') {
            return process.env.RENDER_SERVICE_ID || 'render-production';
        }
        
        const networkInterfaces = os.networkInterfaces();
        const cpus = os.cpus();
        const hostname = os.hostname();
        
        let macAddress = '';
        for (const name of Object.keys(networkInterfaces)) {
            for (const iface of networkInterfaces[name]) {
                if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
                    macAddress = iface.mac;
                    break;
                }
            }
            if (macAddress) break;
        }
        
        const machineInfo = `${hostname}|${macAddress}|${cpus[0]?.model || 'unknown'}`;
        const hash = crypto.createHash('sha256').update(machineInfo).digest('hex').substring(0, 32);
        
        return hash;
    } catch (e) {
        console.error('Error getting machine ID:', e);
        return crypto.randomUUID();
    }
}
async function isLicenseValid(negocioId = null) {
    // En producción (Render), calcular días reales basándose en la BD
    if (process.env.NODE_ENV === 'production') {
        if (!negocioId) {
            return {
                valid: true,
                type: 'trial',
                daysRemaining: 7,
                licenciaPlan: 'trial',
                licenciaFechaInicio: null,
                licenciaFechaExpiracion: null
            };
        }

        // Usar la función de BD para calcular días reales
        const { getDiasLicenciaNegocio } = require('./database');
        const result = await getDiasLicenciaNegocio(negocioId);

        return {
            valid: result.valid,
            type: result.type,
            daysRemaining: result.daysRemaining,
            licenciaPlan: result.licenciaPlan,
            licenciaFechaInicio: result.licenciaFechaInicio,
            licenciaFechaExpiracion: result.licenciaFechaExpiracion
        };
    }

    const result = getDaysRemaining(negocioId);
    if (!result.valid && result.type === 'wrong_hardware') {
        return { valid: false, type: 'wrong_hardware', daysRemaining: 0, message: result.message };
    }
    return {
        valid: result.valid,
        type: result.type,
        daysRemaining: result.daysRemaining,
        licenciaPlan: result.licenciaPlan,
        licenciaFechaInicio: result.licenciaFechaInicio,
        licenciaFechaExpiracion: result.licenciaFechaExpiracion
    };
}

function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 3) key += '-';
    }
    
    return key;
}

function getValidKeys() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveValidKeys(keys) {

    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}



async function activateLicenseNegocio(key, plan, negocioId) {
    const { activarLicenciaNegocio } = require('./database');

    if (plan === 'trial') {
        return { success: false, message: 'Plan inválido' };
    }

    if (!PLANS[plan]) {
        return { success: false, message: 'Plan no encontrado' };
    }

    const validKeys = getValidKeys();
    const keyData = validKeys.find(k => k.key === key && k.plan === plan);

    if (!keyData) {
        return { success: false, message: 'Clave inválida o no corresponde a este plan' };
    }

    const planInfo = PLANS[plan];
    const hardwareId = getMachineId();
    const result = await activarLicenciaNegocio(negocioId, plan, planInfo.days, hardwareId);

    if (!result) {
        return { success: false, message: 'Error al activar licencia' };
    }

    const keyIndex = validKeys.findIndex(k => k.key === key);
    validKeys.splice(keyIndex, 1);
    saveValidKeys(validKeys);

    return {
        success: true,
        message: `Licencia activada: ${planInfo.name} (${planInfo.days} días)`,
        plan: plan,
        planName: planInfo.name,
        days: planInfo.days,
        expiresAt: result.fechaExpiracion
    };
}

function initLicense() {
    // Eliminado soporte a instalable local
    return getLicense();
}

function getPlans() {
    return PLANS;
}

function getLicenseInfo(negocioId = null) {
    // Eliminado soporte a instalable local
    return {
        type: 'database',
        negocioId: negocioId
    };
}

module.exports = {
    initLicense,
    getLicense,
    saveLicense,
    getDaysRemaining,
    getDaysRemainingLocal,
    isLicenseValid,
    generateLicenseKey,
    activateLicense,
    activateLicenseNegocio,
    getValidKeys,
    saveValidKeys,
    getMachineId,
    getPlans,
    recordTrialStart,
    getLicenseInfo,
    TRIAL_DAYS,
    PLANS
};
