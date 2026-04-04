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

/**
 * Calcula los totales de una venta procesando el ITBIS ítem por ítem.
 *
 * En lugar de aplicar un 18% plano sobre el total, esta función consulta
 * la `itbis_tasa` de cada servicio en la DB y calcula el impuesto de forma
 * individual, lo que permite mezclar en una misma venta servicios gravados,
 * con tasa reducida o exentos sin distorsionar el ITBIS reportado a la DGII.
 *
 * @param {Array<{ servicio_id: number, cantidad: number }>} items
 *   Lista de ítems enviados desde el POS. Cada ítem debe tener `servicio_id`
 *   y opcionalmente `cantidad` (default 1).
 * @param {import('better-sqlite3').Database} db
 *   Instancia activa de la base de datos (obtenida con getDb()).
 * @param {number} negocioId
 *   ID del negocio — garantiza que solo se lean servicios del tenant correcto.
 * @param {number} [descuento=0]
 *   Descuento global en monto absoluto (RD$). Se distribuye proporcionalmente
 *   entre las líneas antes de calcular el ITBIS de cada una.
 *
 * @returns {{
 *   lineas:        Array<{
 *                    servicio_id: number,
 *                    nombre:      string,
 *                    precio:      number,
 *                    cantidad:    number,
 *                    itbis_tasa:  number,
 *                    subtotal:    number,
 *                    itbis_monto: number,
 *                    total_linea: number
 *                  }>,
 *   subtotal:      number,   // suma de (precio × cantidad) sin ITBIS ni descuento
 *   descuento:     number,   // descuento aplicado (igual al parámetro recibido)
 *   base_imponible:number,   // subtotal − descuento (base para el ITBIS)
 *   total_itbis:   number,   // suma de itbis_monto de todas las líneas
 *   total_general: number    // base_imponible + total_itbis
 * }}
 *
 * @throws {Error} Si un `servicio_id` no existe o no pertenece al negocio.
 */
function calcularTotalesVenta(items, db, negocioId, descuento = 0) {
    if (!items || items.length === 0) {
        throw new Error('calcularTotalesVenta: el array de items no puede estar vacío');
    }

    const stmtServicio = db.prepare(`
        SELECT id, nombre, precio, itbis_tasa, 'servicio' as tipo_item
        FROM   servicios
        WHERE  id = ? AND negocio_id = ? AND estado = 'activo'
    `);
    const stmtProducto = db.prepare(`
        SELECT id, nombre, precio, itbis_tasa, 'producto' as tipo_item
        FROM   productos
        WHERE  id = ? AND negocio_id = ? AND estado = 'activo'
    `);
    const stmtMenuItem = db.prepare(`
        SELECT id, nombre, precio, itbis_tasa, 'menu' as tipo_item
        FROM   menu_items
        WHERE  id = ? AND negocio_id = ? AND disponible = 1
    `);

    const lineasCrudas = items.map((item) => {
        const cantidad = Math.max(1, parseInt(item.cantidad, 10) || 1);
        let entidad = null;

        if (item.servicio_id) {
            entidad = stmtServicio.get(parseInt(item.servicio_id, 10), negocioId);
            if (!entidad) {
                throw new Error(`Servicio ID ${item.servicio_id} no valido para el negocio ${negocioId}`);
            }
        } else if (item.producto_id) {
            entidad = stmtProducto.get(parseInt(item.producto_id, 10), negocioId);
            if (!entidad) {
                throw new Error(`Producto ID ${item.producto_id} no valido para el negocio ${negocioId}`);
            }
        } else if (item.menu_item_id) {
            entidad = stmtMenuItem.get(parseInt(item.menu_item_id, 10), negocioId);
            if (!entidad) {
                throw new Error(`Menu item ID ${item.menu_item_id} no valido para el negocio ${negocioId}`);
            }
        } else {
            throw new Error('Cada item debe tener servicio_id, producto_id o menu_item_id');
        }

        const tasa = (entidad.itbis_tasa !== null && entidad.itbis_tasa !== undefined)
            ? entidad.itbis_tasa
            : 18;
        const precio = round2(entidad.precio);
        const subtotal = multiplySafe(precio, cantidad);

        return {
            servicio_id:  entidad.tipo_item === 'servicio' ? entidad.id : null,
            producto_id:  entidad.tipo_item === 'producto' ? entidad.id : null,
            menu_item_id: entidad.tipo_item === 'menu' ? entidad.id : null,
            tipo_item:    entidad.tipo_item,
            nombre:       entidad.nombre,
            precio,
            cantidad,
            itbis_tasa:   tasa,
            subtotal,
            _precio_original: precio
        };
    });

    // ── 2. Calcular subtotal bruto y validar el descuento ────────────────────
    const subtotalBruto  = round2(lineasCrudas.reduce((acc, l) => acc + l.subtotal, 0));
    const descuentoFinal = round2(Math.min(Math.max(parseFloat(descuento) || 0, 0), subtotalBruto));
    const baseImponible  = round2(subtotalBruto - descuentoFinal);

    // ── 3. Distribuir el descuento proporcionalmente y calcular ITBIS por línea
    //    Fórmula de prorrateo:
    //      descuento_linea = descuento_total × (subtotal_linea / subtotal_bruto)
    //    Si subtotalBruto es 0 (borde imposible pero defensivo) no hay descuento.
    let totalITBIS       = 0;
    let sumaSubtotales   = 0;   // acumulador para ajuste de redondeo en última línea

    const lineas = lineasCrudas.map((linea, idx) => {
        // Descuento proporcional a esta línea
        const descuentoLinea = (subtotalBruto > 0)
            ? round2(descuentoFinal * (linea.subtotal / subtotalBruto))
            : 0;

        const baseLinea    = round2(linea.subtotal - descuentoLinea);
        const itbis_monto  = round2(baseLinea * (linea.itbis_tasa / 100));
        const total_linea  = round2(baseLinea + itbis_monto);

        totalITBIS     = round2(totalITBIS + itbis_monto);
        sumaSubtotales = round2(sumaSubtotales + linea.subtotal);

        return {
            servicio_id:  linea.servicio_id,
            producto_id:  linea.producto_id,
            menu_item_id: linea.menu_item_id,
            tipo_item:    linea.tipo_item,
            nombre:       linea.nombre,
            precio:       linea.precio,
            cantidad:     linea.cantidad,
            itbis_tasa:   linea.itbis_tasa,
            subtotal:     linea.subtotal,
            itbis_monto,
            total_linea
        };
    });

    const totalGeneral = round2(baseImponible + totalITBIS);

    return {
        lineas,
        subtotal:       subtotalBruto,
        descuento:      descuentoFinal,
        base_imponible: baseImponible,
        total_itbis:    totalITBIS,
        total_general:  totalGeneral
    };
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
    TIPOS_ECF,
    calcularTotalesVenta
};
