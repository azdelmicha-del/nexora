/**
 * Generador de XML e-CF para DGII (República Dominicana)
 * Basado en el esquema oficial e-CF v1.0
 * 
 * Uso: Solo genera XML localmente para validación manual
 * La firma digital y envío a DGII se implementarán en fase posterior
 */

const { round2, formatAmountXML, formatDateXML, generarSecuenciaECF, generarCodigoSeguridad, TIPOS_ECF } = require('./dgii');

/**
 * Generar XML de Factura de Consumo (e-CF 32) o Crédito Fiscal (e-CF 31)
 * @param {Object} datos - Datos de la venta
 * @returns {string} XML formateado
 */
function generarXMLConsumo(datos) {
    const {
        rncEmisor,
        razonSocialEmisor,
        rncComprador,
        nombreComprador,
        secuencia,
        fechaEmision,
        items,
        subtotal,
        descuento = 0,
        itbis,
        total,
        codigoSeguridad,
        tipoECF = '32'
    } = datos;

    const fechaFmt = formatarFechaXML(fechaEmision);

    // Calcular subtotal bruto de items para distribuir descuento proporcionalmente
    const subtotalBruto = round2(items.reduce((sum, item) => sum + round2(item.precio * (item.cantidad || 1)), 0));

    const detallesXML = items.map((item, i) => {
        const linea = i + 1;
        const precioUnitario = round2(item.precio);
        const montoBruto = round2(precioUnitario * item.cantidad);
        
        // Distribuir descuento proporcionalmente a este item
        const proporcionDescuento = subtotalBruto > 0 ? round2(montoBruto / subtotalBruto) : 0;
        const descuentoItem = round2(proporcionDescuento * descuento);
        const montoNeto = round2(montoBruto - descuentoItem);
        
        // ITBIS sobre el monto neto (con descuento aplicado)
        const itbisItem = item.excento ? 0 : round2(montoNeto * 0.18);
        const tasaITBIS = item.excento ? '0' : '18';

        return `
        <DetalleLiquidacion>
            <NumeroLinea>${linea}</NumeroLinea>
            <NombreItem>${escapeXML(item.nombre)}</NombreItem>
            <CantidadItem>${item.cantidad}</CantidadItem>
            <PrecioUnitarioItem>${formatAmountXML(precioUnitario)}</PrecioUnitarioItem>
            <MontoItem>${formatAmountXML(montoBruto)}</MontoItem>
            <IndicadorFacturacion>${item.excento ? 2 : 1}</IndicadorFacturacion>
            <TasaITBIS>${tasaITBIS}</TasaITBIS>
            <ITBIS18>${formatAmountXML(itbisItem)}</ITBIS18>
            <MontoITBIS>${formatAmountXML(itbisItem)}</MontoITBIS>
        </DetalleLiquidacion>`;
    }).join('');

    const descuentoNode = descuento > 0 ? `
            <MontoDescuentoGlobal>${formatAmountXML(descuento)}</MontoDescuentoGlobal>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<ECF xmlns="www.dgii.gov.do/ecf" version="1.0">
    <Encabezado>
        <Version>1.0</Version>
        <IdDoc>
            <TipoECF>${tipoECF}</TipoECF>
            <eNCF>${secuencia}</eNCF>
            <FechaEmision>${fechaFmt}</FechaEmision>
        </IdDoc>
        <Emisor>
            <RNCEmisor>${escapeXML(rncEmisor)}</RNCEmisor>
            <RazonSocialEmisor>${escapeXML(razonSocialEmisor)}</RazonSocialEmisor>
        </Emisor>
        <Comprador>
            <RNCComprador>${escapeXML(rncComprador || '')}</RNCComprador>
            <RazonSocialComprador>${escapeXML(nombreComprador || 'CLIENTE DE CONTADO')}</RazonSocialComprador>
        </Comprador>
        <Totales>
            <MontoGravadoTotal>${formatAmountXML(subtotal)}</MontoGravadoTotal>
            <MontoExento>0.00</MontoExento>${descuentoNode}
            <TotalITBIS>${formatAmountXML(itbis)}</TotalITBIS>
            <MontoTotal>${formatAmountXML(total)}</MontoTotal>
        </Totales>
    </Encabezado>
    <DetallesItems>${detallesXML}
    </DetallesItems>
    <InformacionReferencia>
        <CodigoSeguridad>${codigoSeguridad || generarCodigoSeguridad()}</CodigoSeguridad>
    </InformacionReferencia>
</ECF>`;
}

/**
 * Generar XML de Crédito Fiscal (e-CF 31)
 * Requiere RNC o Cédula del comprador obligatoriamente
 */
function generarXMLCreditoFiscal(datos) {
    const doc = String(datos.rncComprador || '').replace(/[\s\-]/g, '');
    if (!doc || (doc.length !== 9 && doc.length !== 11)) {
        throw new Error('Factura de Crédito Fiscal requiere RNC (9) o Cédula (11) válido del comprador');
    }

    return generarXMLConsumo({ ...datos, tipoECF: '31' });
}

/**
 * Formatear fecha para XML DGII (YYYY-MM-DD)
 */
function formatarFechaXML(fechaStr) {
    if (!fechaStr) {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    
    // Si ya tiene formato datetime, extraer solo la fecha
    const fechaLimpia = fechaStr.split(' ')[0];
    
    // Si ya está en YYYY-MM-DD, devolverla
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaLimpia)) {
        return fechaLimpia;
    }
    
    // Si está en DD-MM-YYYY, convertir
    const partes = fechaLimpia.split('-');
    if (partes.length === 3 && partes[0].length === 2) {
        return `${partes[2]}-${partes[1]}-${partes[0]}`;
    }
    
    return fechaLimpia;
}

/**
 * Escapar caracteres especiales para XML
 */
function escapeXML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Generar XML completo para una venta
 * @param {Object} venta - Registro de venta de la DB
 * @param {Object} negocio - Datos del negocio (emisor)
 * @param {Object} cliente - Datos del cliente (comprador)
 * @param {Array} detalles - Items de la venta
 * @returns {string} XML formateado
 */
function generarXMLVenta(venta, negocio, cliente, detalles) {
    const rncEmisor = negocio.rnc || '';
    const razonSocial = negocio.nombre || '';
    const rncComprador = cliente?.documento || '';
    const nombreComprador = cliente?.nombre || 'CLIENTE DE CONTADO';
    const secuencia = venta.secuencia_ecf || generarSecuenciaECF(venta.tipo_ecf || '31', venta.id);
    const codigoSeguridad = venta.codigo_seguridad || generarCodigoSeguridad();

    const items = detalles.map(d => ({
        nombre: d.servicio || d.nombre || 'Servicio',
        cantidad: d.cantidad || 1,
        precio: d.precio || 0,
        excento: false
    }));

    // Usar SIEMPRE los valores exactos de la DB
    const subtotal = round2(parseFloat(venta.subtotal || 0));
    const descuento = round2(parseFloat(venta.descuento || 0));
    const itbis = round2(parseFloat(venta.itbis || 0));
    const total = round2(parseFloat(venta.total || 0));

    const tipoECF = venta.tipo_ecf || '31';

    if (tipoECF === '31') {
        return generarXMLCreditoFiscal({
            rncEmisor, razonSocialEmisor: razonSocial,
            rncComprador, nombreComprador,
            secuencia, fechaEmision: venta.fecha,
            items, subtotal, descuento, itbis, total,
            codigoSeguridad
        });
    }

    return generarXMLConsumo({
        rncEmisor, razonSocialEmisor: razonSocial,
        rncComprador, nombreComprador,
        secuencia, fechaEmision: venta.fecha,
        items, subtotal, descuento, itbis, total,
        codigoSeguridad, tipoECF
    });
}

module.exports = {
    generarXMLConsumo,
    generarXMLCreditoFiscal,
    generarXMLVenta,
    escapeXML
};
