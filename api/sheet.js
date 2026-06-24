// Sheet endpoints (auth-gated). Proves the spine: logged-in request -> reads the live sheet.
const express = require('express');
const { requireAuth } = require('../lib/session');
const sheets = require('../lib/sheets');

const router = express.Router();

// quick proof of connectivity: sheet title + tab names
router.get('/ping', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await sheets.meta()) }); }
  catch (e) { console.error('sheet/ping', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
