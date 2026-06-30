// Credit-card sync as a function (server port of pipeline/sync.js).
// pull (incremental, per item) -> categorize new -> write to the month tab, with dedup,
// filing each charge under the month it was BOUGHT (authorized_date).
const sheets = require('../lib/sheets');
const cfg = require('../lib/config');
const H = require('./helpers');
const plaidc = require('./plaid');
const { categorize } = require('./categorize');
const itemsStore = require('./items');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colorFor = (label) => H.hexToRgb(H.CARD_COLORS[label] || '#000000');

async function pullIncremental(plaid, item) {
  let cursor = item.cursor, added = [], modified = [], tries = 0;
  while (true) {
    try {
      const d = (await plaid.transactionsSync({ access_token: item.access_token, cursor, count: 200 })).data;
      added.push(...d.added); modified.push(...d.modified);
      cursor = d.next_cursor;
      if (!d.has_more) break;
    } catch (e) {
      const code = e.response && e.response.data && e.response.data.error_code;
      if (code === 'PRODUCT_NOT_READY' && tries < 8) { tries++; await sleep(5000); continue; }
      throw e;
    }
  }
  item.cursor = cursor;
  return added.concat(modified);
}

// Sync one month. Returns a summary object (no throwing on empties).
async function runCardsMonth(targetMonth, { dry = false } = {}) {
  const plaid = plaidc.client();
  const items = await itemsStore.loadItems();
  const ccItems = items.filter((i) => (i.accounts || []).some((a) => a.subtype === 'credit card'));
  const log = [];

  let pulled = [];
  for (const item of ccItems) {
    const creditIds = new Set((item.accounts || []).filter((a) => a.subtype === 'credit card').map((a) => a.account_id));
    const got = await pullIncremental(plaid, item);
    const kept = got.filter((t) => creditIds.has(t.account_id));
    kept.forEach((t) => (t._label = item.label));
    pulled.push(...kept);
    if (!dry) await itemsStore.saveCursor(item.label, item.cursor); // persist advanced cursor
    log.push(`${item.label}: pulled ${got.length}`);
  }

  const byMonth = {};
  pulled.filter((t) => !H.isPayment(t)).forEach((t) => { (byMonth[H.monthName(H.txnDate(t))] ||= []).push(t); });
  const monthTxns = byMonth[targetMonth] || [];
  if (!monthTxns.length) return { month: targetMonth, log, written: 0, recurring: 0, blanked: [], rows: [] };

  const layout = await H.findLayout(targetMonth);
  if (!layout) return { month: targetMonth, log, error: `tab "${targetMonth}" not found`, written: 0, recurring: 0, blanked: [], rows: [] };

  const matchesSplit = (t) => (layout.splitMarkers || []).some((m) => {
    const n = H.cleanName(t).toLowerCase();
    return Math.abs(m.total - t.amount) < 0.01 && H.daysApart(m.iso, H.txnDate(t)) <= 4 && (m.merchant.includes(n) || n.includes(m.merchant));
  });
  const fresh = monthTxns.filter((t) => !layout.expenseKeys.has(H.dedupKey(H.txnDate(t), t.amount)) && !matchesSplit(t));
  if (!fresh.length) return { month: targetMonth, log, written: 0, recurring: 0, blanked: [], rows: [], present: monthTxns.length };

  const recurringNames = Object.values(layout.recurring).map((r) => r.name);
  const plan = await categorize(fresh, recurringNames);

  // positive "Bilt Housing Payment" IS the mortgage
  plan.forEach((p) => { if (/bilt housing/i.test(H.cleanName(p.txn)) && Number(p.txn.amount) > 0) { p.recurringMatch = 'Mortgage'; p.category = 'Shelter'; p.subcategory = 'Mortgage'; } });

  const groups = {};
  plan.forEach((p) => { if (p.recurringMatch) (groups[p.recurringMatch.toLowerCase()] ||= []).push(p); });
  const recurringUpdates = [];
  for (const [name, ps] of Object.entries(groups)) {
    const info = layout.recurring[name] || layout.recurring[Object.keys(layout.recurring).find((k) => k.includes(name) || name.includes(k)) || ''];
    if (!info || info.bold) continue;
    ps.sort((a, b) => Math.abs(a.txn.amount - (info.amount ?? a.txn.amount)) - Math.abs(b.txn.amount - (info.amount ?? b.txn.amount)));
    ps[0]._recurring = true;
    recurringUpdates.push({ row: info.row, date: H.fmtDate(H.txnDate(ps[0].txn)), amount: Number(ps[0].txn.amount), label: ps[0].txn._label });
    ps.slice(1).forEach((x) => { x._inheritCat = info.cat; x._inheritSub = info.sub; });
  }

  const overrides = (p) => { if (H.cleanName(p.txn).toLowerCase().includes('hungry greek')) return { category: 'Food', subcategory: 'Eating Out' }; return null; };
  const seen = new Set();
  const expenseRows = [], blanked = [];
  plan.filter((p) => !p._recurring).forEach((p) => {
    const k = H.dedupKey(H.txnDate(p.txn), p.txn.amount);
    if (seen.has(k) || layout.expenseKeys.has(k)) return; seen.add(k);
    let cat = p.category, sub = p.subcategory;
    if (p._inheritCat !== undefined) { cat = p._inheritCat; sub = p._inheritSub; }
    const ov = overrides(p); if (ov) { cat = ov.category; sub = ov.subcategory; }
    if (H.isUnguessable(p)) { cat = ''; sub = ''; blanked.push(H.cleanName(p.txn) + ' $' + p.txn.amount); }
    if (cat === 'Vacation' && p.tripName) sub = p.tripName;
    const label = p.txn._label;
    expenseRows.push({ values: [H.fmtDate(H.txnDate(p.txn)), H.cleanName(p.txn), label, Number(p.txn.amount), '', cat, sub], label });
  });

  const rows = expenseRows.map((r) => ({ date: r.values[0], merchant: r.values[1], card: r.label, amount: r.values[3], cat: r.values[5], sub: r.values[6] }));
  if (dry) return { month: targetMonth, log, dry: true, written: 0, recurring: recurringUpdates.length, blanked, rows };

  const SID = cfg.SHEET_ID, sheetId = layout.sheetId, s = await sheets.client();
  const data = recurringUpdates.flatMap((u) => ([
    { range: `${targetMonth}!A${u.row}`, values: [[u.date]] },
    { range: `${targetMonth}!C${u.row}`, values: [[u.label]] },
    { range: `${targetMonth}!D${u.row}`, values: [[u.amount]] },
  ]));
  if (data.length) await s.spreadsheets.values.batchUpdate({ spreadsheetId: SID, requestBody: { valueInputOption: 'USER_ENTERED', data } });
  if (expenseRows.length) {
    const start = layout.firstExpenseRow, end = start + expenseRows.length - 1;
    await s.spreadsheets.values.update({ spreadsheetId: SID, range: `${targetMonth}!A${start}:G${end}`, valueInputOption: 'USER_ENTERED', requestBody: { values: expenseRows.map((r) => r.values) } });
  }
  const reqs = [];
  recurringUpdates.forEach((u) => {
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: u.row - 1, endRowIndex: u.row, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: u.row - 1, endRowIndex: u.row, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: colorFor(u.label) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
  });
  expenseRows.forEach((r, i) => {
    const row = layout.firstExpenseRow - 1 + i;
    reqs.push({ repeatCell: { range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: colorFor(r.label) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
  });
  if (reqs.length) await s.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: reqs } });

  return { month: targetMonth, log, written: expenseRows.length, recurring: recurringUpdates.length, blanked, rows };
}

module.exports = { runCardsMonth };
