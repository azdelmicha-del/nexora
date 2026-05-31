const express = require('express');
const { getDb , normalizeId } = require('../database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/details/:id', async (req, res) => {
  const db = getDb();
  const isSuperAdmin = !!req.session?.superAdminId;
  const userRole = req.session?.user?.rol;
  
  if (!isSuperAdmin && userRole !== 'admin') {
    return res.status(401).json({ error: 'No autorizado' });
  }
  
  const id = normalizeId(req.params.id);
  const collectionsToCheck = ['citas', 'usuarios', 'clientes', 'negocios', 'servicios'];
  let found = null;
  for (const collection of collectionsToCheck) {
    try {
      const row = await db.collection(collection).findOne({ id });
      if (row) {
        const { _id, ...data } = row;
        found = { collection, data: { id: _id.toString(), ...data } };
        break;
      }
    } catch (e) {
      // Skip if collection does not exist or fails
    }
  }

  if (found) {
    return res.json({ id, found: found.collection, data: found.data });
  }

  res.json({ id, found: null, data: null, note: 'No data found in known collections' });
});

module.exports = router;
