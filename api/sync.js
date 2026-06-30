// On-demand sync trigger for the app's "Sync now" button (auth-gated).
// Runs the same engine as the daily cron. A module-level lock prevents two runs at once.
const express = require('express');
const { requireAuth } = require('../lib/session');
const { runSync } = require('../sync');

const router = express.Router();
let running = false;

router.post('/', requireAuth, async (req, res) => {
  if (running) return res.status(409).json({ error: 'A sync is already running — give it a minute.' });
  running = true;
  try {
    const scope = req.body && req.body.scope === 'cards' ? 'cards' : 'all';
    const dry = !!(req.body && req.body.dry);
    const result = await runSync({ scope, dry });
    res.json(result);
  } catch (e) { console.error('sync POST', e); res.status(500).json({ error: e.message }); }
  finally { running = false; }
});

module.exports = router;
