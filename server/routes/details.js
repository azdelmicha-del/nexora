const express = require('express');
const { getDb } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Ruta para obtener detalles de un recurso por id (intencion General)
// Prioriza tablas comunes: citas, usuarios, clientes, negocios, servicios
router.get('/details/:id', async (req, res) => {
  const db = getDb();
  const isSuperAdmin = !!req.session?.superAdminId;
  const userRole = req.session?.user?.rol;
  
  if (!isSuperAdmin && userRole !== 'admin') {
    return res.status(401).json({ error: 'No autorizado' });
  }
  
  const id = req.params.id;
  const tablesToCheck = ['citas', 'usuarios', 'clientes', 'negocios', 'servicios'];
  let found = null;
  for (const table of tablesToCheck) {
    try {
      // Usamos parámetro para evitar inyección; tabla dinámica controlada por lista
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (row) {
        found = { table, data: row };
        break;
      }
    } catch (e) {
      // Saltar si la tabla no existe o falla
    }
  }

  if (found) {
    return res.json({ id, found: found.table, data: found.data });
  }

  // No se encontró en estas tablas; devolver un fallback seguro
  res.json({ id, found: null, data: null, note: 'No data found in known tables' });
});

module.exports = router;
