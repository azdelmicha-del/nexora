const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRDDateString, getRDDate } = require('../utils/timezone');
const { toTitleCase, capitalizeFirst } = require('../utils/validators');
const path = require('path');
const fs = require('fs');

const router = express.Router();

function getLogoUploadsDir() {
    return path.join(__dirname, '..', '..', 'public', 'uploads', 'logos');
}

function getOldLogoPathIfManaged(logoValue) {
    if (!logoValue || typeof logoValue !== 'string') return null;
    if (!logoValue.startsWith('/uploads/logos/')) return null;
    const fileName = path.basename(logoValue);
    return path.join(getLogoUploadsDir(), fileName);
}

router.get('/', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM negocios WHERE id = ?').get(req.session.negocioId);

        if (!config) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        res.json(config);
    } catch (error) {
        console.error('Error al obtener configuración:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.put('/', requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;

        const camposPermitidos = [
            'nombre', 'slug', 'rnc', 'telefono', 'email', 'direccion', 'logo',
            'moneda', 'formato_moneda', 'hora_apertura', 'hora_cierre',
            'dias_laborales', 'duracion_minima_cita', 'permitir_solapamiento',
            'tiempo_anticipacion', 'tiempo_cancelacion', 'mostrar_impuestos',
            'activar_descuentos', 'seleccion_obligatoria_cliente',
            'metodo_efectivo', 'metodo_transferencia', 'metodo_tarjeta',
            'chatbot_activo', 'chatbot_bienvenida', 'notificaciones_activas', 'booking_activo',
            'buffer_entre_citas', 'tipo_negocio', 'whatsapp_negocio',
            'delivery_activo', 'delivery_costo', 'delivery_tiempo', 'delivery_minimo'
        ];

        const updates = [];
        const values = [];

        // Validar RNC si se proporcionó
        if (req.body.rnc !== undefined && req.body.rnc !== null && req.body.rnc !== '') {
            const rncClean = String(req.body.rnc).replace(/[\s\-]/g, '');
            if (rncClean.length !== 9 && rncClean.length !== 11) {
                return res.status(400).json({ error: 'RNC Inválido: Debe tener 9 dígitos (Jurídico) u 11 dígitos (Cédula)' });
            }
            if (!/^\d+$/.test(rncClean)) {
                return res.status(400).json({ error: 'RNC Inválido: Solo se permiten números' });
            }
            req.body.rnc = rncClean;
        }

        for (const campo of camposPermitidos) {
            if (req.body[campo] !== undefined) {
                updates.push(`${campo} = ?`);
                let valor = req.body[campo];
                if (campo === 'nombre') valor = toTitleCase(valor);
                if (campo === 'direccion') valor = capitalizeFirst(valor);
                values.push(valor);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(negocioId);
        db.prepare(`UPDATE negocios SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const updated = db.prepare('SELECT * FROM negocios WHERE id = ?').get(negocioId);
        res.json(updated);
    } catch (error) {
        console.error('Error al actualizar configuración:', error);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

router.post('/logo', requireAuth, requireAdmin, (req, res) => {
    try {
        if (!req.files || !req.files.logo) {
            return res.status(400).json({ error: 'Debe seleccionar un archivo de logo' });
        }

        const logoFile = req.files.logo;
        const ext = path.extname(logoFile.name || '').toLowerCase();
        const allowedExt = ['.png', '.jpg', '.jpeg', '.webp'];
        const allowedMime = ['image/png', 'image/jpeg', 'image/webp'];

        if (!allowedExt.includes(ext) || !allowedMime.includes(logoFile.mimetype)) {
            return res.status(400).json({ error: 'Formato invalido. Use PNG, JPG o WEBP' });
        }

        const db = getDb();
        const negocio = db.prepare('SELECT logo FROM negocios WHERE id = ?').get(req.session.negocioId);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const uploadsDir = getLogoUploadsDir();
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const fileName = `logo-${req.session.negocioId}-${Date.now()}${ext}`;
        const absolutePath = path.join(uploadsDir, fileName);
        const relativePath = `/uploads/logos/${fileName}`;

        logoFile.mv(absolutePath, (err) => {
            if (err) {
                console.error('Error guardando logo:', err);
                return res.status(500).json({ error: 'No se pudo guardar el logo' });
            }

            const oldLogoPath = getOldLogoPathIfManaged(negocio.logo);
            if (oldLogoPath && fs.existsSync(oldLogoPath)) {
                try { fs.unlinkSync(oldLogoPath); } catch (_) {}
            }

            db.prepare('UPDATE negocios SET logo = ? WHERE id = ?').run(relativePath, req.session.negocioId);
            res.json({ success: true, logo: relativePath });
        });
    } catch (error) {
        console.error('Error subiendo logo:', error);
        res.status(500).json({ error: 'Error al subir logo' });
    }
});

router.delete('/logo', requireAuth, requireAdmin, (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT logo FROM negocios WHERE id = ?').get(req.session.negocioId);
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const oldLogoPath = getOldLogoPathIfManaged(negocio.logo);
        if (oldLogoPath && fs.existsSync(oldLogoPath)) {
            try { fs.unlinkSync(oldLogoPath); } catch (_) {}
        }

        db.prepare('UPDATE negocios SET logo = NULL WHERE id = ?').run(req.session.negocioId);
        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando logo:', error);
        res.status(500).json({ error: 'Error al eliminar logo' });
    }
});

router.get('/dashboard', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocioId = req.session.negocioId;
        const hoy = getRDDateString();

        // La caja siempre está abierta para nuevas ventas
        const clientesNuevos = db.prepare(`
            SELECT COUNT(*) as cantidad
            FROM clientes
            WHERE negocio_id = ? AND DATE(fecha_registro) = ?
        `).get(negocioId, hoy);

        const totalClientes = db.prepare(`
            SELECT COUNT(*) as cantidad FROM clientes WHERE negocio_id = ? AND estado = 'activo'
        `).get(negocioId);

        const serviciosActivos = db.prepare(`
            SELECT COUNT(*) as cantidad FROM servicios WHERE negocio_id = ? AND estado = 'activo'
        `).get(negocioId);

        const categoriasActivas = db.prepare(`
            SELECT COUNT(*) as cantidad FROM categorias WHERE negocio_id = ? AND estado = 'activo'
        `).get(negocioId);

        let ventasHoy = { total: 0, cantidad: 0 };
        let citasHoy = { cantidad: 0 };
        let ultimasVentas = [];
        let ultimasCitas = [];

        // La caja siempre está abierta - cargar datos siempre
        ventasHoy = db.prepare(`
                SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as cantidad
                FROM ventas
                WHERE negocio_id = ? AND DATE(fecha) = ?
            `).get(negocioId, hoy);

            citasHoy = db.prepare(`
                SELECT COUNT(*) as cantidad
                FROM citas
                WHERE negocio_id = ? AND fecha = ? AND estado != 'cancelada'
            `).get(negocioId, hoy);

            ultimasVentas = db.prepare(`
                SELECT v.id, v.total, v.metodo_pago, v.fecha, c.nombre as cliente
                FROM ventas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.negocio_id = ?
                ORDER BY v.fecha DESC
                LIMIT 5
            `).all(negocioId);

        ultimasCitas = db.prepare(`
            SELECT cit.id, cit.fecha, cit.hora_inicio, cit.estado, cl.nombre as cliente, s.nombre as servicio
            FROM citas cit
            JOIN clientes cl ON cit.cliente_id = cl.id
            JOIN servicios s ON cit.servicio_id = s.id
            WHERE cit.negocio_id = ?
            ORDER BY cit.fecha DESC, cit.hora_inicio DESC
            LIMIT 5
        `).all(negocioId);

        res.json({
            hoy: {
                ventas: ventasHoy,
                citas: citasHoy,
                clientesNuevos: clientesNuevos
            },
            resumen: {
                totalClientes: totalClientes.cantidad,
                serviciosActivos: serviciosActivos.cantidad,
                categoriasActivas: categoriasActivas.cantidad
            },
            ultimasVentas,
            ultimasCitas,
            caja_cerrada: false // Siempre abierta para nuevas ventas
        });
    } catch (error) {
        console.error('Error al obtener dashboard:', error);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
});

// Obtener slug del negocio
router.get('/slug', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const negocio = db.prepare('SELECT slug, booking_activo FROM negocios WHERE id = ?')
            .get(req.session.negocioId);
        res.json(negocio || { slug: null, booking_activo: 1 });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// Actualizar slug del negocio
router.put('/slug', requireAdmin, (req, res) => {
    try {
        const { slug } = req.body;
        const db = getDb();
        
        if (!slug || slug.length < 3) {
            return res.status(400).json({ error: 'Slug muy corto (minimo 3 caracteres)' });
        }
        
        const slugLimpio = slug.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/^-+|-+$/g, '');
        
        const exist = db.prepare('SELECT id FROM negocios WHERE slug = ? AND id != ?')
            .get(slugLimpio, req.session.negocioId);
        
        if (exist) {
            return res.status(400).json({ error: 'Este link ya esta en uso' });
        }
        
        db.prepare('UPDATE negocios SET slug = ? WHERE id = ?')
            .run(slugLimpio, req.session.negocioId);
        
        res.json({ success: true, slug: slugLimpio });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

// Subir certificado .p12/.pfx
router.post('/certificado', requireAuth, requireAdmin, (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const forge = require('node-forge');
        
        // Verificar que se envió un archivo
        if (!req.files || !req.files.certificado) {
            return res.status(400).json({ error: 'Debe subir un archivo .p12 o .pfx' });
        }
        
        const certFile = req.files.certificado;
        const { password, ambiente } = req.body;
        
        // Validar extensión
        const ext = path.extname(certFile.name).toLowerCase();
        if (ext !== '.p12' && ext !== '.pfx') {
            return res.status(400).json({ error: 'Solo se permiten archivos .p12 o .pfx' });
        }
        
        // Validar contraseña
        if (!password || password.length < 4) {
            return res.status(400).json({ error: 'La contraseña del certificado es requerida (mínimo 4 caracteres)' });
        }
        
        // Validar certificado con node-forge ANTES de guardar
        let certInfo = { vencimiento: null, sujeto: null };
        try {
            const p12Buffer = certFile.data;
            const p12Asn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(p12Buffer)));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
            
            // Extraer certificado del contenedor PKCS#12
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const certs = certBags[forge.pki.oids.certBag];
            
            if (certs && certs.length > 0) {
                const cert = certs[0].cert;
                certInfo.vencimiento = cert.validity.notAfter.toISOString();
                certInfo.sujeto = cert.subject.getField('CN')?.value || cert.subject.attributes.map(a => a.value).join(', ');
            }
        } catch (e) {
            // Contraseña incorrecta o archivo dañado
            return res.status(401).json({ error: 'La contraseña no coincide con el certificado seleccionado o el archivo está dañado' });
        }
        
        // Crear carpeta protegida fuera de acceso público
        const certDir = path.join(__dirname, '..', 'certificados');
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }
        
        // Crear .gitignore en la carpeta
        const gitignorePath = path.join(certDir, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, '*\n!.gitignore\n');
        }
        
        // Guardar archivo con nombre del negocio_id
        const fileName = `cert-${req.session.negocioId}${ext}`;
        const filePath = path.join(certDir, fileName);
        certFile.mv(filePath, (err) => {
            if (err) {
                console.error('Error guardando certificado:', err);
                return res.status(500).json({ error: 'Error al guardar el certificado' });
            }
            
            // Guardar en la DB
            const db = getDb();
            const bcrypt = require('bcryptjs');
            const passEncriptada = bcrypt.hashSync(password, 10);
            
            db.prepare(`
                UPDATE negocios 
                SET certificado_path = ?, certificado_pass = ?, ambiente_dgii = ?, 
                    cert_vencimiento = ?, cert_sujeto = ?, estado_dgii = 'inscrito'
                WHERE id = ?
            `).run(filePath, passEncriptada, ambiente || 'certificacion', 
                   certInfo.vencimiento, certInfo.sujeto, req.session.negocioId);
            
            res.json({ 
                success: true, 
                message: 'Certificado guardado correctamente',
                certificado: {
                    sujeto: certInfo.sujeto,
                    vencimiento: certInfo.vencimiento
                }
            });
        });
    } catch (error) {
        console.error('Error subiendo certificado:', error);
        res.status(500).json({ error: 'Error al procesar el certificado' });
    }
});

// Eliminar certificado
router.delete('/certificado', requireAuth, requireAdmin, (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const db = getDb();
        
        const config = db.prepare('SELECT certificado_path FROM negocios WHERE id = ?').get(req.session.negocioId);
        
        if (config.certificado_path && fs.existsSync(config.certificado_path)) {
            fs.unlinkSync(config.certificado_path);
        }
        
        db.prepare(`
            UPDATE negocios 
            SET certificado_path = NULL, certificado_pass = NULL, estado_dgii = 'no_inscrito'
            WHERE id = ?
        `).run(req.session.negocioId);
        
        res.json({ success: true, message: 'Certificado eliminado' });
    } catch (error) {
        console.error('Error eliminando certificado:', error);
        res.status(500).json({ error: 'Error al eliminar el certificado' });
    }
});

module.exports = router;
