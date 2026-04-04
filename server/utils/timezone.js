/**
 * Utilidad centralizada para zona horaria de República Dominicana (UTC-4)
 * Garantiza consistencia de fechas/horas entre local y Render (que usa UTC)
 */

const RD_TIMEZONE = 'America/Santo_Domingo';
const RD_OFFSET = -4; // UTC-4

/**
 * Obtiene la fecha/hora actual en República Dominicana
 * @returns {Date} Objeto Date con hora de RD
 */
function getRDDate() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcMs + (RD_OFFSET * 3600000));
}

/**
 * Formatea fecha en formato YYYY-MM-DD (hora RD)
 * @param {Date} [date] - Fecha opcional, usa ahora si no se pasa
 * @returns {string} YYYY-MM-DD
 */
function getRDDateString(date) {
    const d = date || getRDDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Formatea fecha/hora en formato YYYY-MM-DD HH:MM:SS (hora RD)
 * @param {Date} [date] - Fecha opcional, usa ahora si no se pasa
 * @returns {string} YYYY-MM-DD HH:MM:SS
 */
function getRDTimestamp(date) {
    const d = date || getRDDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Convierte una fecha UTC a hora RD
 * @param {string|Date} utcDate - Fecha en UTC
 * @returns {Date} Fecha convertida a hora RD
 */
function utcToRD(utcDate) {
    const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
    const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utcMs + (RD_OFFSET * 3600000));
}

/**
 * Obtiene el inicio del día en RD (YYYY-MM-DD 00:00:00)
 * @returns {string}
 */
function getRDStartOfDay() {
    return getRDDateString() + ' 00:00:00';
}

/**
 * Obtiene el fin del día en RD (YYYY-MM-DD 23:59:59)
 * @returns {string}
 */
function getRDEndOfDay() {
    return getRDDateString() + ' 23:59:59';
}

/**
 * Calcula días restantes entre ahora (RD) y una fecha futura
 * @param {string|Date} futureDate - Fecha futura
 * @returns {number} Días restantes (puede ser negativo)
 */
function daysUntilRD(futureDate) {
    const now = getRDDate();
    const future = typeof futureDate === 'string' ? new Date(futureDate) : futureDate;
    return Math.floor((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

module.exports = {
    getRDDate,
    getRDDateString,
    getRDTimestamp,
    utcToRD,
    getRDStartOfDay,
    getRDEndOfDay,
    daysUntilRD,
    RD_TIMEZONE,
    RD_OFFSET
};
