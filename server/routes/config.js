const express = require('express');
const { getDb, normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getRDDateString, getRDDate } = require('../utils/timezone');
const { toTitleCase, capitalizeFirst } = require('../utils/validators');
const path = require('path');
const fs = require('fs');

const router = express.Router();

function mapId(doc) {
    if (!doc) return null;
    const { _id, ...rest } = doc.toObject ? doc.toObject() : { ...doc };
    return { id: _id.toString(), ...rest };
}

function getLogoUploadsDir() {
    return path.join(__dirname, '..', '..', 'public', 'uploads', 'logos');
}

function getOldLogoPathIfManaged(logoValue) {
    if (!logoValue || typeof logoValue !== 'string') return null;
    if (!logoValue.startsWith('/uploads/logos/')) return null;
    const fileName = path.basename(logoValue);
    return path.join(getLogoUploadsDir(), fileName);
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const config = await db.collection('negocios').findOne({ _id: normalizeId(req.session.negocioId) });

        if (!config) {
            return res.status(404).json({ error: 'Negocio no encontrado' });
        }

        res.json(mapId(config));
    } catch (error) {
        console.error('Error al obtener configuración:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

router.put('/', requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);

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

        const $set = {};

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
                let valor = req.body[campo];
                if (campo === 'nombre') valor = toTitleCase(valor);
                if (campo === 'direccion') valor = capitalizeFirst(valor);
                $set[campo] = valor;
            }
        }

        if (Object.keys($set).length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        await db.collection('negocios').updateOne(
            { _id: normalizeId(negocioId) },
            { $set }
        );

        const updated = await db.collection('negocios').findOne({ _id: normalizeId(negocioId) });
        res.json(mapId(updated));
    } catch (error) {
        console.error('Error al actualizar configuración:', error);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

router.post('/logo', requireAuth, requireAdmin, async (req, res) => {
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
        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.session.negocioId) });
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const uploadsDir = getLogoUploadsDir();
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

        const fileName = `logo-${normalizeId(req.session.negocioId)}-${Date.now()}${ext}`;
        const absolutePath = path.join(uploadsDir, fileName);
        const relativePath = `/uploads/logos/${fileName}`;

        logoFile.mv(absolutePath, async (err) => {
            if (err) {
                console.error('Error guardando logo:', err);
                return res.status(500).json({ error: 'No se pudo guardar el logo' });
            }

            const oldLogoPath = getOldLogoPathIfManaged(negocio.logo);
            if (oldLogoPath && fs.existsSync(oldLogoPath)) {
                try { fs.unlinkSync(oldLogoPath); } catch (_) {}
            }

            await db.collection('negocios').updateOne(
                { _id: normalizeId(req.session.negocioId) },
                { $set: { logo: relativePath } }
            );
            res.json({ success: true, logo: relativePath });
        });
    } catch (error) {
        console.error('Error subiendo logo:', error);
        res.status(500).json({ error: 'Error al subir logo' });
    }
});

router.delete('/logo', requireAuth, requireAdmin, async (req, res) => {
    try {
        const db = getDb();
        const negocio = await db.collection('negocios').findOne({ _id: normalizeId(req.session.negocioId) });
        if (!negocio) return res.status(404).json({ error: 'Negocio no encontrado' });

        const oldLogoPath = getOldLogoPathIfManaged(negocio.logo);
        if (oldLogoPath && fs.existsSync(oldLogoPath)) {
            try { fs.unlinkSync(oldLogoPath); } catch (_) {}
        }

        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.session.negocioId) },
            { $set: { logo: null } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando logo:', error);
        res.status(500).json({ error: 'Error al eliminar logo' });
    }
});

router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocioId = normalizeId(req.session.negocioId);
        const hoy = getRDDateString();

        const clientesNuevos = await db.collection('clientes').findOne(
            { negocio_id: normalizeId(negocioId), fecha_registro: { $gte: new Date(hoy), $lt: new Date(new Date(hoy).getTime() + 86400000) } },
            { projection: { _id: 1 } }
        );
        const clientesNuevosCount = clientesNuevos ? 1 : 0;

        const totalClientes = await db.collection('clientes').countDocuments({ negocio_id: normalizeId(negocioId), estado: 'activo' });

        const serviciosActivos = await db.collection('servicios').countDocuments({ negocio_id: normalizeId(negocioId), estado: 'activo' });

        const categoriasActivas = await db.collection('categorias').countDocuments({ negocio_id: normalizeId(negocioId), estado: 'activo' });

        let ventasHoyTotal = 0;
        let ventasHoyCantidad = 0;
        let citasHoyCantidad = 0;
        let ultimasVentas = [];
        let ultimasCitas = [];

        const ventasHoyDocs = await db.collection('ventas').find({
            negocio_id: normalizeId(negocioId),
            fecha: { $gte: new Date(hoy), $lt: new Date(new Date(hoy).getTime() + 86400000) }
        }).toArray();
        ventasHoyCantidad = ventasHoyDocs.length;
        ventasHoyTotal = ventasHoyDocs.reduce((sum, v) => sum + (v.total || 0), 0);

        citasHoyCantidad = await db.collection('citas').countDocuments({
            negocio_id: normalizeId(negocioId),
            fecha: hoy,
            estado: { $ne: 'cancelada' }
        });

        ultimasVentas = await db.collection('ventas')
            .find({ negocio_id: normalizeId(negocioId) })
            .sort({ fecha: -1 })
            .limit(5)
            .toArray();

        ultimasCitas = await db.collection('citas')
            .find({ negocio_id: normalizeId(negocioId) })
            .sort({ fecha: -1, hora_inicio: -1 })
            .limit(5)
            .toArray();

        res.json({
            hoy: {
                ventas: { total: ventasHoyTotal, cantidad: ventasHoyCantidad },
                citas: { cantidad: citasHoyCantidad },
                clientesNuevos: { cantidad: clientesNuevosCount }
            },
            resumen: {
                totalClientes,
                serviciosActivos,
                categoriasActivas
            },
            ultimasVentas: ultimasVentas.map(mapId),
            ultimasCitas: ultimasCitas.map(mapId),
            caja_cerrada: false
        });
    } catch (error) {
        console.error('Error al obtener dashboard:', error);
        res.status(500).json({ error: 'Error al obtener datos del dashboard' });
    }
});

router.get('/slug', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const negocio = await db.collection('negocios').findOne(
            { _id: normalizeId(req.session.negocioId) },
            { projection: { slug: 1, booking_activo: 1 } }
        );
        res.json(negocio ? mapId(negocio) : { slug: null, booking_activo: 1 });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

router.put('/slug', requireAdmin, async (req, res) => {
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

        const exist = await db.collection('negocios').findOne({
            slug: slugLimpio,
            _id: { $ne: normalizeId(req.session.negocioId) }
        });

        if (exist) {
            return res.status(400).json({ error: 'Este link ya esta en uso' });
        }

        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.session.negocioId) },
            { $set: { slug: slugLimpio } }
        );

        res.json({ success: true, slug: slugLimpio });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar' });
    }
});

router.post('/certificado', requireAuth, requireAdmin, async (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const forge = require('node-forge');

        if (!req.files || !req.files.certificado) {
            return res.status(400).json({ error: 'Debe subir un archivo .p12 o .pfx' });
        }

        const certFile = req.files.certificado;
        const { password, ambiente } = req.body;

        const ext = path.extname(certFile.name).toLowerCase();
        if (ext !== '.p12' && ext !== '.pfx') {
            return res.status(400).json({ error: 'Solo se permiten archivos .p12 o .pfx' });
        }

        if (!password || password.length < 4) {
            return res.status(400).json({ error: 'La contraseña del certificado es requerida (mínimo 4 caracteres)' });
        }

        let certInfo = { vencimiento: null, sujeto: null };
        try {
            const p12Buffer = certFile.data;
            const p12Asn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(p12Buffer)));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const certs = certBags[forge.pki.oids.certBag];

            if (certs && certs.length > 0) {
                const cert = certs[0].cert;
                certInfo.vencimiento = cert.validity.notAfter.toISOString();
                certInfo.sujeto = cert.subject.getField('CN')?.value || cert.subject.attributes.map(a => a.value).join(', ');
            }
        } catch (e) {
            return res.status(401).json({ error: 'La contraseña no coincide con el certificado seleccionado o el archivo está dañado' });
        }

        const certDir = path.join(__dirname, '..', 'certificados');
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
        }

        const gitignorePath = path.join(certDir, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, '*\n!.gitignore\n');
        }

        const fileName = `cert-${normalizeId(req.session.negocioId)}${ext}`;
        const filePath = path.join(certDir, fileName);
        certFile.mv(filePath, async (err) => {
            if (err) {
                console.error('Error guardando certificado:', err);
                return res.status(500).json({ error: 'Error al guardar el certificado' });
            }

            const db = getDb();
            const bcrypt = require('bcryptjs');
            const passEncriptada = bcrypt.hashSync(password, 10);

            await db.collection('negocios').updateOne(
                { _id: normalizeId(req.session.negocioId) },
                {
                    $set: {
                        certificado_path: filePath,
                        certificado_pass: passEncriptada,
                        ambiente_dgii: ambiente || 'certificacion',
                        cert_vencimiento: certInfo.vencimiento,
                        cert_sujeto: certInfo.sujeto,
                        estado_dgii: 'inscrito'
                    }
                }
            );

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

router.delete('/certificado', requireAuth, requireAdmin, async (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const db = getDb();

        const config = await db.collection('negocios').findOne(
            { _id: normalizeId(req.session.negocioId) },
            { projection: { certificado_path: 1 } }
        );

        if (config && config.certificado_path && fs.existsSync(config.certificado_path)) {
            fs.unlinkSync(config.certificado_path);
        }

        await db.collection('negocios').updateOne(
            { _id: normalizeId(req.session.negocioId) },
            {
                $set: {
                    certificado_path: null,
                    certificado_pass: null,
                    estado_dgii: 'no_inscrito'
                }
            }
        );

        res.json({ success: true, message: 'Certificado eliminado' });
    } catch (error) {
        console.error('Error eliminando certificado:', error);
        res.status(500).json({ error: 'Error al eliminar el certificado' });
    }
});

router.get('/platform', async (req, res) => {
    try {
        const db = getDb();
        const cfg = await db.collection('platform_config').findOne({ id: 1 });
        res.json(cfg ? mapId(cfg) : { system_name: 'Nexora', version: '1.0.0', edition: 'Pro', copyright_year: new Date().getFullYear(), show_footer: 1, custom_text: '' });
    } catch (error) {
        res.json({ system_name: 'Nexora', version: '1.0.0', edition: 'Pro', copyright_year: new Date().getFullYear(), show_footer: 1, custom_text: '' });
    }
});

module.exports = router;
