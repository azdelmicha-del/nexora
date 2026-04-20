const { formatters, validators, errorMessages } = require('./validators');

const TIPOS_DOC_VALIDOS = ['rnc', 'cedula', 'pasaporte', 'otro'];

function normalizeCanonicalClientInput(raw = {}, options = {}) {
    const { requireName = false, requirePhone = false } = options;

    const input = { ...raw };
    let nombre = input.nombre ? formatters.toTitleCase(input.nombre) : '';
    let telefono = input.telefono ? String(input.telefono).trim() : '';
    let email = input.email ? String(input.email).trim() : '';
    let notas = input.notas !== undefined && input.notas !== null ? String(input.notas).trim() : null;
    let tipo_documento = input.tipo_documento ? String(input.tipo_documento).trim().toLowerCase() : null;
    let documento = input.documento !== undefined && input.documento !== null ? String(input.documento).trim() : null;

    if (requireName && !nombre) {
        throw new Error('El nombre es requerido');
    }

    if (nombre && nombre.length > 100) {
        throw new Error('El nombre no puede exceder 100 caracteres');
    }

    if (requirePhone && !telefono) {
        throw new Error('El celular es requerido');
    }

    if (telefono) {
        if (!validators.telefonoRD(telefono)) {
            throw new Error(errorMessages.telefonoInvalido);
        }
        telefono = formatters.toPhone(telefono);
    } else {
        telefono = null;
    }

    const comparablePhone = telefono ? formatters.toComparablePhone(telefono) : '';

    if (email) {
        email = formatters.toEmail(email);
        if (!validators.email(email)) {
            throw new Error(errorMessages.emailNoPermitido);
        }
    } else {
        email = null;
    }

    if (documento) {
        if (tipo_documento && !TIPOS_DOC_VALIDOS.includes(tipo_documento)) {
            throw new Error('tipo_documento debe ser: rnc, cedula, pasaporte u otro');
        }
        if (documento.length > 30) {
            throw new Error('El documento no puede exceder 30 caracteres');
        }
    } else {
        documento = null;
        tipo_documento = null;
    }

    if (notas === '') {
        notas = null;
    }

    return {
        nombre,
        telefono,
        comparablePhone,
        email,
        notas,
        tipo_documento,
        documento
    };
}

function findCanonicalClient(db, negocioId, canonical) {
    if (canonical.comparablePhone && canonical.comparablePhone.length >= 10) {
        const byPhone = db.prepare(`
            SELECT * FROM clientes
            WHERE negocio_id = ?
              AND REPLACE(REPLACE(REPLACE(telefono, '-', ''), ' ', ''), '+', '') LIKE ?
            LIMIT 1
        `).get(negocioId, `%${canonical.comparablePhone}`);

        if (byPhone) return byPhone;
    }

    if (canonical.email) {
        const byEmail = db.prepare(`
            SELECT * FROM clientes
            WHERE negocio_id = ? AND email = ?
            LIMIT 1
        `).get(negocioId, canonical.email);

        if (byEmail) return byEmail;
    }

    return null;
}

function upsertCanonicalClient(db, negocioId, rawInput, options = {}) {
    const {
        requireName = true,
        requirePhone = true,
        createIfMissing = true,
        updateMissingFields = true
    } = options;

    const canonical = normalizeCanonicalClientInput(rawInput, { requireName, requirePhone });
    const existente = findCanonicalClient(db, negocioId, canonical);

    if (existente) {
        if (updateMissingFields) {
            const updates = [];
            const values = [];

            if (canonical.nombre && !existente.nombre) {
                updates.push('nombre = ?');
                values.push(canonical.nombre);
            }
            if (canonical.telefono && !existente.telefono) {
                updates.push('telefono = ?');
                values.push(canonical.telefono);
            }
            if (canonical.email && !existente.email) {
                updates.push('email = ?');
                values.push(canonical.email);
            }
            if (canonical.tipo_documento && !existente.tipo_documento) {
                updates.push('tipo_documento = ?');
                values.push(canonical.tipo_documento);
            }
            if (canonical.documento && !existente.documento) {
                updates.push('documento = ?');
                values.push(canonical.documento);
            }
            if (canonical.notas && !existente.notas) {
                updates.push('notas = ?');
                values.push(canonical.notas);
            }

            if (updates.length > 0) {
                values.push(existente.id, negocioId);
                db.prepare(`UPDATE clientes SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`).run(...values);
            }
        }

        return db.prepare('SELECT * FROM clientes WHERE id = ?').get(existente.id);
    }

    if (!createIfMissing) return null;

    const result = db.prepare(`
        INSERT INTO clientes (negocio_id, nombre, telefono, email, tipo_documento, documento, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        negocioId,
        canonical.nombre,
        canonical.telefono,
        canonical.email,
        canonical.tipo_documento,
        canonical.documento,
        canonical.notas
    );

    return db.prepare('SELECT * FROM clientes WHERE id = ?').get(result.lastInsertRowid);
}

module.exports = {
    normalizeCanonicalClientInput,
    findCanonicalClient,
    upsertCanonicalClient
};
