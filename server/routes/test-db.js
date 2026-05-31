const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const path = require('path');
const fs = require('fs');

router.get('/test-db', async (req, res) => {
    try {
        const db = getDb();
        const dbPath = process.env.DB_DIR || path.join(__dirname, '..', 'db');

        // Check MongoDB connection by pinging a collection
        let dbConnected = false;
        try {
            await db.collection('users').findOne();
            dbConnected = true;
        } catch (e) {
            dbConnected = false;
        }

        res.json({
            status: 'OK',
            dbDir: dbPath,
            dbExists: dbConnected,
            env_DB_DIR: process.env.DB_DIR || 'not set',
            cwd: process.cwd(),
            dirname: __dirname
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
