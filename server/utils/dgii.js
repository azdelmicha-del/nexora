/**
 * Módulo de utilidades DGII - Precisión, Validación y Formateo
 */

/**
 * Redondeo estricto a 2 decimales (anti punto flotante)
 * Obligatorio para todos los cálculos fiscales
 */
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Suma segura de montos
 */
function sumSafe(...values) {
    return round2(values.reduce((acc, v) => acc + (parseFloat(v) || 0), 0));
}

/**
 * Multiplicación segura (precio × cantidad)
 */
function multiplySafe(a, b) {
    return round2((parseFloat(a) || 0) * (parseFloat(b) || 0));
}

/**
 * Calcular ITBIS 18% sobre un monto
 * @param {number} montoBase - Monto sin impuesto
 * @returns {number} ITBIS redondeado a 2 decimales
 */
function calcITBIS18(montoBase) {
    return round2((parseFloat(montoBase) || 0) * 0.18);
}

/**
 * Calcular ITBIS 16% sobre un monto (productos con tasa reducida)
 */
function calcITBIS16(montoBase) {
    return round2((parseFloat(montoBase) || 0) * 0.16);
}

/**
 * Separar ITBIS de un monto que ya lo incluye
 * total = subtotal + itbis = subtotal * 1.18
 * itbis = total * 18 / 118
 */
function extractITBIS18(totalConITBIS) {
    return round2((parseFloat(totalConITBIS) || 0) * 18 / 118);
}

/**
 * Validar RNC dominicano (9 dígitos - persona jurídica)
 * @param {string} rnc
 * @returns {{ valid: boolean, type: string, formatted: string }}
 */
function validateRNC(rnc) {
    if (!rnc) return { valid: false, type: null, formatted: '' };

    const clean = String(rnc).replace(/[\s\-]/g, '');

    if (/^\d{9}$/.test(clean)) {
        return {
            valid: true,
            type: 'rnc',
            formatted: clean,
            display: `${clean.substring(0, 3)}-${clean.substring(3, 5)}-${clean.substring(5)}`
        };
    }

    return { valid: false, type: null, formatted: clean };
}

/**
 * Validar Cédula dominicana (11 dígitos - persona física)
 * @param {string} cedula
 * @returns {{ valid: boolean, type: string, formatted: string }}
 */
function validateCedula(cedula) {
    if (!cedula) return { valid: false, type: null, formatted: '' };

    const clean = String(cedula).replace(/[\s\-]/g, '');

    if (/^\d{11}$/.test(clean)) {
        return {
            valid: true,
            type: 'cedula',
            formatted: clean,
            display: `${clean.substring(0, 3)}-${clean.substring(3, 10)}-${clean.substring(10)}`
        };
    }

    return { valid: false, type: null, formatted: clean };
}

/**
 * Validar RNC o Cédula (cualquiera de los dos formatos)
 * @param {string} documento - RNC (9 dígitos) o Cédula (11 dígitos)
 * @returns {{ valid: boolean, type: string|null, formatted: string }}
 */
function validateDocumento(documento) {
    if (!documento) return { valid: false, type: null, formatted: '' };

    const clean = String(documento).replace(/[\s\-]/g, '');

    // RNC (9 dígitos)
    if (/^\d{9}$/.test(clean)) {
        return {
            valid: true,
            type: 'rnc',
            formatted: clean,
            display: `${clean.substring(0, 3)}-${clean.substring(3, 5)}-${clean.substring(5)}`
        };
    }

    // Cédula (11 dígitos)
    if (/^\d{11}$/.test(clean)) {
        return {
            valid: true,
            type: 'cedula',
            formatted: clean,
            display: `${clean.substring(0, 3)}-${clean.substring(3, 10)}-${clean.substring(10)}`
        };
    }

    return { valid: false, type: null, formatted: clean };
}

/**
 * Formatear monto para XML DGII (2 decimales, punto como separador)
 */
function formatAmountXML(value) {
    return round2(parseFloat(value) || 0).toFixed(2);
}

/**
 * Formatear fecha para XML DGII (DD-MM-YYYY)
 */
function formatDateXML(dateStr) {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Generar secuencia e-CF
 * Formato: E3100000000001 (tipo + número secuencial)
 * @param {string} tipoECF - Tipo de e-CF (31=Consumo, 32=Crédito Fiscal, etc.)
 * @param {number} numero - Número secuencial
 */
function generarSecuenciaECF(tipoECF, numero) {
    const tipo = String(tipoECF).padStart(2, '0');
    const num = String(numero).padStart(10, '0');
    return `E${tipo}${num}`;
}

/**
 * Tipos de e-CF según DGII
 */
const TIPOS_ECF = {
    '31': 'Factura de Crédito Fiscal Electrónica',
    '32': 'Factura de Consumo Electrónica',
    '33': 'Nota de Débito Electrónica',
    '34': 'Nota de Crédito Electrónica',
    '41': 'Factura de Compras',
    '43': 'Nota de Crédito Especial',
    '44': 'Nota de Débito Especial',
    '45': 'Factura Gubernamental',
    '46': 'Factura de Exportación',
    '47': 'Factura para Regímenes Especiales'
};

/**
 * Generar código de seguridad aleatorio (para e-CF)
 */
function generarCodigoSeguridad() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 40; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

module.exports = {
    round2,
    sumSafe,
    multiplySafe,
    calcITBIS18,
    calcITBIS16,
    extractITBIS18,
    validateRNC,
    validateCedula,
    validateDocumento,
    formatAmountXML,
    formatDateXML,
    generarSecuenciaECF,
    generarCodigoSeguridad,
    TIPOS_ECF
};
