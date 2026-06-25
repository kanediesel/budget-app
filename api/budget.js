// Budget summary + targets (auth-gated).
const express = require('express');
const { requireAuth } = require('../lib/session');
const budget = require('../lib/budget');
const { db } = require('../lib/supabase');

const router = express.Router();

async function getTargets() {
  const { data } = await db().from('budget_targets').select('*');
  const o = {};
  (data || []).forEach((t) => { o[t.budget_key] = { amount: Number(t.amount), period: t.period }; });
  return o;
}

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const [s, targets] = await Promise.all([budget.summary(year, month), getTargets()]);
    res.json({ ...s, targets });
  } catch (e) { console.error('budget/summary', e); res.status(500).json({ error: e.message }); }
});

router.post('/targets', requireAuth, async (req, res) => {
  try {
    const { budget_key, amount, period } = req.body;
    if (!budget_key) return res.status(400).json({ error: 'budget_key required' });
    const { error } = await db().from('budget_targets').upsert({
      budget_key, amount: Number(amount) || 0, period: period || 'monthly', updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.json({ ok: true, targets: await getTargets() });
  } catch (e) { console.error('budget/targets', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
