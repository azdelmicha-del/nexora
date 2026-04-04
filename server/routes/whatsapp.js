const express = require('express');
const { getDb } = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/whatsapp — Configuracion WhatsApp
router.get('/config', requireAuth, (req, res) => {
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM whatsapp_config WHERE negocio_id = ?').get(req.session.negocioId);
        res.json(config || { activo: 0, plantilla_recordatorio: 'recordatorio_cita', plantilla_confirmacion: 'confirmacion_cita' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al obtener config WhatsApp' });
    }
});

// PUT /api/whatsapp/config — Actualizar config
router.put('/config', requireAuth, (req, res) => {
    try {
        const { token, phone_number_id, activo, plantilla_recordatorio, plantilla_confirmacion } = req.body;
        const db = getDb();
        const negocioId = req.session.negocioId;

        const existente = db.prepare('SELECT id FROM whatsapp_config WHERE negocio_id = ?').get(negocioId);
        if (existente) {
            db.prepare(`
                UPDATE whatsapp_config SET token=?, phone_number_id=?, activo=?, plantilla_recordatorio=?, plantilla_confirmacion=?
                WHERE negocio_id=?
            `).run(token||null, phone_number_id||null, activo?1:0, plantilla_recordatorio, plantilla_confirmacion, negocioId);
        } else {
            db.prepare(`
                INSERT INTO whatsapp_config (negocio_id, token, phone_number_id, activo, plantilla_recordatorio, plantilla_confirmacion)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(negocioId, token||null, phone_number_id||null, activo?1:0, plantilla_recordatorio, plantilla_confirmacion);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al actualizar config WhatsApp' });
    }
});

// POST /api/whatsapp/send — Enviar mensaje (via Meta Cloud API)
router.post('/send', requireAuth, async (req, res) => {
    try {
        const { to, template, language = 'es' } = req.body;
        if (!to || !template) {
            return res.status(400).json({ error: 'to y template son requeridos' });
        }

        const db = getDb();
        const config = db.prepare('SELECT * FROM whatsapp_config WHERE negocio_id = ? AND activo = 1').get(req.session.negocioId);
        if (!config || !config.token || !config.phone_number_id) {
            return res.status(400).json({ error: 'WhatsApp no configurado o no activo' });
        }

        const response = await fetch(`https://graph.facebook.com/v17.0/${config.phone_number_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'template',
                template: { name: template, language: { code: language } }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ error: data.error?.message || 'Error al enviar' });
        }

        res.json({ success: true, message_id: data.messages?.[0]?.id });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al enviar WhatsApp' });
    }
});

// POST /api/whatsapp/send-image — Enviar imagen via WhatsApp API
router.post('/send-image', requireAuth, async (req, res) => {
    try {
        const { to, caption, image_base64 } = req.body;
        if (!to || !image_base64) {
            return res.status(400).json({ error: 'to e image_base64 son requeridos' });
        }

        const db = getDb();
        const config = db.prepare('SELECT * FROM whatsapp_config WHERE negocio_id = ? AND activo = 1').get(req.session.negocioId);
        if (!config || !config.token || !config.phone_number_id) {
            return res.status(400).json({ error: 'WhatsApp no configurado o no activo' });
        }

        // Subir imagen a WhatsApp Media API
        const formData = new FormData();
        const buffer = Buffer.from(image_base64.replace(/^data:image\/png;base64,/, ''), 'base64');
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', new Blob([buffer], { type: 'image/png' }), 'factura.png');
        formData.append('type', 'image/png');

        const uploadResponse = await fetch(`https://graph.facebook.com/v17.0/${config.phone_number_id}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${config.token}` },
            body: formData
        });

        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
            return res.status(uploadResponse.status).json({ error: uploadData.error?.message || 'Error al subir imagen' });
        }

        const mediaId = uploadData.id;

        // Enviar imagen al cliente
        const sendResponse = await fetch(`https://graph.facebook.com/v17.0/${config.phone_number_id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'image',
                image: { id: mediaId, caption: caption || 'Factura' }
            })
        });

        const sendData = await sendResponse.json();
        if (!sendResponse.ok) {
            return res.status(sendResponse.status).json({ error: sendData.error?.message || 'Error al enviar imagen' });
        }

        res.json({ success: true, message_id: sendData.messages?.[0]?.id });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al enviar imagen por WhatsApp: ' + error.message });
    }
});

// Webhook para WhatsApp (verificacion + recepcion)
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

router.post('/webhook', (req, res) => {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
        // Procesar mensajes entrantes aqui
        console.log('WhatsApp webhook:', JSON.stringify(body));
    }
    res.sendStatus(200);
});

module.exports = router;
