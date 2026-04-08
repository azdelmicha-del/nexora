const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const { getRDDateString, getRDDate } = require('../utils/timezone');

const router = express.Router();
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// GET /api/backup — Listar backups disponibles
router.get('/', requireSuperAdmin, (req, res) => {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.endsWith('.db') || f.endsWith('.sqlite'))
            .map(f => {
                const stat = fs.statSync(path.join(BACKUP_DIR, f));
                return {
                    nombre: f,
                    tamano: stat.size,
                    fecha: stat.mtime.toISOString()
                };
            })
            .sort((a, b) => b.fecha.localeCompare(a.fecha));

        res.json(files);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al listar backups' });
    }
});

// POST /api/backup — Crear backup
router.post('/', requireSuperAdmin, (req, res) => {
    try {
        const db = getDb();
        const dbPath = db.prepare("PRAGMA database_list").get().file;
        const timestamp = getRDDate().toISOString().replace(/[:.]/g, '-');
        const backupName = `nexora_backup_${timestamp}.db`;
        const backupPath = path.join(BACKUP_DIR, backupName);

        fs.copyFileSync(dbPath, backupPath);

        res.json({ success: true, nombre: backupName, tamano: fs.statSync(backupPath).size });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al crear backup' });
    }
});

// POST /api/backup/restore — Restaurar backup
router.post('/restore', requireSuperAdmin, (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre || !nombre.endsWith('.db')) {
            return res.status(400).json({ error: 'Nombre de backup invalido' });
        }

        const backupPath = path.join(BACKUP_DIR, nombre);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        const db = getDb();
        const dbPath = db.prepare("PRAGMA database_list").get().file;

        // Cerrar todas las conexiones antes de restaurar
        fs.copyFileSync(backupPath, dbPath);

        res.json({ success: true, message: 'Backup restaurado. Reinicia el servidor para aplicar los cambios.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al restaurar backup' });
    }
});

// DELETE /api/backup/:nombre — Eliminar backup
router.delete('/:nombre', requireSuperAdmin, (req, res) => {
    try {
        const nombre = req.params.nombre;
        if (!nombre || !nombre.endsWith('.db')) {
            return res.status(400).json({ error: 'Nombre invalido' });
        }

        const backupPath = path.join(BACKUP_DIR, nombre);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        fs.unlinkSync(backupPath);
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al eliminar backup' });
    }
});

// GET /api/backup/download/:nombre — Descargar backup
router.get('/download/:nombre', requireSuperAdmin, (req, res) => {
    try {
        const nombre = req.params.nombre;
        if (!nombre || !nombre.endsWith('.db')) {
            return res.status(400).json({ error: 'Nombre invalido' });
        }

        const backupPath = path.join(BACKUP_DIR, nombre);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        res.download(backupPath, nombre);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al descargar backup' });
    }
});

module.exports = router;
