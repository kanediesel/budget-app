// Manual line-item entry (cash / oddities) + taxonomy for the form dropdowns.
const express = require('express');
const { requireAuth } = require('../lib/session');
const sw = require('../lib/sheet-write');
const taxonomy = require('../lib/taxonomy.json');

const router = express.Router();
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const ACCOUNT_COLORS = sw.ACCOUNT_COLORS;

// dropdown data (exclude Revenue — this form is for expenses)
router.get('/taxonomy', requireAuth, (req, res) => {
  const cats = {};
  for (const [k, v] of Object.entries(taxonomy.categories)) if (k !== 'Revenue') cats[k] = v;
  res.json({ categories: cats, accounts: taxonomy.accounts, vacationOpen: !!taxonomy.vacationOpen });
});

router.post('/', requireAuth, async (req, res) => {
  try {
    let { date, merchant, amount, category, subcategory, account } = req.body;
    if (!date || !merchant || amount == null || !category) return res.status(400).json({ error: 'date, merchant, amount, category are required' });
    if (!taxonomy.categories[category]) return res.status(400).json({ error: 'unknown category' });
    account = account || 'Cash';

    const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const Y = +m[1], M = +m[2], D = +m[3];
    const curYear = new Date().getFullYear();
    if (Y !== curYear) return res.status(400).json({ error: `For now, manual entries must be in ${curYear} (historical entry coming later).` });

    const tab = MONTHS[M - 1];
    const amt = Number(String(amount).replace(/[^0-9.\-]/g, '')) || 0;
    const color = ACCOUNT_COLORS[account] || '#000000';
    const row = [`${M}/${D}/${Y}`, String(merchant).trim(), account, amt, '', category, subcategory || ''];
    const written = await sw.appendExpenseRow(tab, row, color);
    res.json({ ok: true, tab, row: written });
  } catch (e) { console.error('entry POST', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
