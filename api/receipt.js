// Receipt split: parse a photo -> proposed split; commit the (edited) split to the sheet.
const express = require('express');
const { requireAuth } = require('../lib/session');
const { parse } = require('../lib/receipt');
const sw = require('../lib/sheet-write');

const router = express.Router();
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// 1) parse the image -> proposed split
router.post('/parse', requireAuth, async (req, res) => {
  try {
    const { image, mediaType } = req.body;
    if (!image) return res.status(400).json({ error: 'image (base64) required' });
    const parsed = await parse(image, mediaType || 'image/jpeg');
    // resolve the account: cash (handwriting) > known card last-4 > unknown (let the user pick)
    parsed.account = parsed.account === 'Cash' ? 'Cash' : (sw.LAST4_ACCOUNTS[parsed.cardLast4] || null);
    res.json(parsed);
  } catch (e) { console.error('receipt/parse', e); res.status(500).json({ error: e.message }); }
});

// 2) commit the edited split -> write rows (replace existing charge in place, or append)
router.post('/commit', requireAuth, async (req, res) => {
  try {
    let { date, merchant, total, account, lines } = req.body;
    if (!date || !merchant || !Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'date, merchant, lines required' });
    if (!account) return res.status(400).json({ error: 'Pick the card/account this was paid with.' });

    const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const Y = +m[1], M = +m[2], D = +m[3];
    const curYear = new Date().getFullYear();
    if (Y !== curYear) return res.status(400).json({ error: `For now, receipts must be in ${curYear}.` });
    const tab = MONTHS[M - 1];
    const mdy = `${M}/${D}/${Y}`;

    // clean amounts + reconcile so the split sums to the charged total (handwriting can be a few cents off)
    lines = lines.map((l) => ({ category: l.category, subcategory: l.subcategory || '', amount: Math.round((Number(String(l.amount).replace(/[^0-9.\-]/g, '')) || 0) * 100) / 100 }));
    const grand = total != null ? Math.round(Number(String(total).replace(/[^0-9.\-]/g, '')) * 100) / 100 : lines.reduce((a, l) => a + l.amount, 0);
    let sum = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
    const diff = Math.round((grand - sum) * 100) / 100;
    if (Math.abs(diff) >= 0.01 && lines.length) { // nudge the largest line to make it sum exactly
      let idx = 0; lines.forEach((l, i) => { if (l.amount > lines[idx].amount) idx = i; });
      lines[idx].amount = Math.round((lines[idx].amount + diff) * 100) / 100;
    }

    const result = await sw.writeSplit(tab, lines, { date: mdy, merchant: String(merchant).trim(), account });
    require('../lib/ledger').bust(); // chat agent should see this write immediately
    res.json({ ok: true, tab, ...result, reconciledTotal: grand });
  } catch (e) { console.error('receipt/commit', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
