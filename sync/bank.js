// USAA bank sync as a function (server port of pipeline/usaa.js).
// Revenue -> top (col E), recurring + one-time debit expenses, savings/checking balances.
// Excludes card payments + the Bilt mortgage funding; flags Venmo/PayPal/Greenlight transfers.
const sheets = require('../lib/sheets');
const cfg = require('../lib/config');
const H = require('./helpers');
const plaidc = require('./plaid');
const { categorize } = require('./categorize');
const itemsStore = require('./items');

const LABEL = 'USAA';
const COLOR = H.hexToRgb(H.CARD_COLORS[LABEL]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isCardPaymentOut = (t) => {
  const p = t.personal_finance_category || {};
  if (p.detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return true;
  if (/capital one|bilt|citi|chase|apple card|discover|amex|american express|barclays|synchrony|wells fargo/i.test(t.name)) return true;
  return false;
};
const isAppTransfer = (t) => /venmo|paypal|zelle|cash app|greenlight/i.test(t.name) || (t.personal_finance_category || {}).primary === 'TRANSFER_OUT';
function revenueSub(t) {
  const n = t.name.toLowerCase(); const p = t.personal_finance_category || {};
  if (p.detailed === 'INCOME_INTEREST_EARNED' || /interest/.test(n)) return 'Interest';
  if (/skaled/.test(n)) return 'Skaled';
  if (/state of florida|dept of health|department of health|\bdoh\b/.test(n)) return 'Dept of Health';
  if (/reimburse|atm/.test(n)) return 'Reimbursements';
  if (/refund/.test(n)) return 'Refunds';
  return 'Misc.';
}

async function runBankMonth(targetMonth, { year, dry = false } = {}) {
  const plaid = plaidc.client();
  const items = await itemsStore.loadItems();
  const item = items.find((i) => i.label === LABEL);
  if (!item) return { month: targetMonth, skipped: 'no USAA item connected', written: 0 };
  const checking = (item.accounts || []).find((a) => a.subtype === 'checking');
  const savings = (item.accounts || []).find((a) => a.subtype === 'savings');
  if (!checking) return { month: targetMonth, skipped: 'no USAA checking account', written: 0 };

  const layout = await H.findLayout(targetMonth);
  if (!layout) return { month: targetMonth, error: `tab "${targetMonth}" not found`, written: 0 };

  let bal;
  try { bal = await plaid.accountsGet({ access_token: item.access_token }); }
  catch (e) {
    const code = (e.response && e.response.data && e.response.data.error_code) || e.message;
    return { month: targetMonth, skipped: `USAA needs re-login (${code})`, needsReauth: [{ label: LABEL, code }], written: 0 };
  }
  const balOf = (id) => { const a = bal.data.accounts.find((x) => x.account_id === id); return a ? a.balances.current : null; };
  const savingsBal = savings ? balOf(savings.account_id) : null;
  const checkingBal = checking ? balOf(checking.account_id) : null;

  // full pull (USAA isn't tracked incrementally — re-pull + dedup against the sheet)
  let cursor, added = [], tries = 0;
  while (true) {
    try { const d = (await plaid.transactionsSync({ access_token: item.access_token, cursor, count: 200 })).data; added.push(...d.added); cursor = d.next_cursor; if (!d.has_more) break; }
    catch (e) { const c = e.response && e.response.data && e.response.data.error_code; if (c === 'PRODUCT_NOT_READY' && tries < 10) { tries++; await sleep(5000); continue; } throw e; }
  }
  const prefix = `${year}-${String(H.MONTHS.indexOf(targetMonth) + 1).padStart(2, '0')}`;
  const txns = added.filter((t) => H.txnDate(t).startsWith(prefix) && t.account_id === checking.account_id);

  const revenue = [], flagged = [], expenseTxns = [];
  for (const t of txns) {
    if (isAppTransfer(t)) { flagged.push([(t.amount < 0 ? 'money-app INBOUND' : 'money-app outbound') + ' (Venmo/PayPal/Greenlight) — manual', t]); continue; }
    if (t.amount < 0) {
      const sub = revenueSub(t);
      if (sub === 'Interest' && Math.abs(t.amount) < 1) { flagged.push(['small interest (<$1, skipped)', t]); continue; }
      revenue.push({ date: H.fmtDate(H.txnDate(t)), merchant: (t.merchant_name || t.name), amount: Math.abs(t.amount), sub });
    } else {
      if (isCardPaymentOut(t)) continue;
      expenseTxns.push(t);
    }
  }

  const recurringNames = Object.values(layout.recurring).map((r) => r.name);
  const plan = expenseTxns.length ? await categorize(expenseTxns, recurringNames) : [];

  const groups = {}; plan.forEach((p) => { if (p.recurringMatch) (groups[p.recurringMatch.toLowerCase()] ||= []).push(p); });
  const recurringUpdates = [];
  for (const [name, ps] of Object.entries(groups)) {
    const info = layout.recurring[name] || layout.recurring[Object.keys(layout.recurring).find((k) => k.includes(name) || name.includes(k)) || ''];
    if (!info || info.bold) continue;
    ps.sort((a, b) => Math.abs(a.txn.amount - (info.amount ?? a.txn.amount)) - Math.abs(b.txn.amount - (info.amount ?? b.txn.amount)));
    ps[0]._recurring = true;
    recurringUpdates.push({ row: info.row, name: info.name, date: H.fmtDate(H.txnDate(ps[0].txn)), amount: Number(ps[0].txn.amount) });
  }
  const expenseRows = [];
  plan.filter((p) => !p._recurring).forEach((p) => {
    let cat = p.category, sub = p.subcategory;
    if (H.isUnguessable(p)) { cat = ''; sub = ''; }
    if (cat === 'Vacation' && p.tripName) sub = p.tripName;
    expenseRows.push([H.fmtDate(H.txnDate(p.txn)), H.cleanName(p.txn), LABEL, Number(p.txn.amount), '', cat, sub]);
  });

  const SID = cfg.SHEET_ID, sheetId = layout.sheetId, s = await sheets.client();

  // dedup expenses against what's already below the grey line + split markers
  const matchesSplit = (iso, merchant, amount) => (layout.splitMarkers || []).some((m) => {
    const n = String(merchant).toLowerCase();
    return Math.abs(m.total - amount) < 0.01 && H.daysApart(m.iso, iso) <= 4 && (m.merchant.includes(n) || n.includes(m.merchant));
  });
  const expFresh = expenseRows.filter((r) => { const iso = H.isoFromSheet(r[0]); return !layout.expenseKeys.has(H.dedupKey(iso, r[3])) && !matchesSplit(iso, r[1], r[3]); });

  // revenue: read existing top block, dedup by date+amount
  const topRows = (await s.spreadsheets.values.get({ spreadsheetId: SID, range: `${targetMonth}!A2:G${layout.grey1 - 1}` })).data.values || [];
  const revKeys = new Set();
  topRows.forEach((r) => { const iso = H.isoFromSheet(r[0]); if (iso && r[4]) revKeys.add(H.dedupKey(iso, H.num(r[4]))); });
  const revFresh = revenue.filter((r) => !revKeys.has(H.dedupKey(H.isoFromSheet(r.date), r.amount)));

  if (dry) {
    return { month: targetMonth, dry: true, written: 0, revenue: revFresh.length, recurring: recurringUpdates.length, expenses: expFresh.length, flagged: flagged.length,
      rows: expFresh.map((r) => ({ date: r[0], merchant: r[1], amount: r[3], cat: r[5], sub: r[6] })) };
  }

  let revRow = 2; for (const r of topRows) { if (r[0] && String(r[0]).trim()) revRow++; else break; }
  const revData = revFresh.map((r, i) => ({ range: `${targetMonth}!A${revRow + i}:G${revRow + i}`, values: [[r.date, r.merchant, '', '', r.amount, 'Revenue', r.sub]] }));
  const recData = recurringUpdates.flatMap((u) => ([
    { range: `${targetMonth}!A${u.row}`, values: [[u.date]] },
    { range: `${targetMonth}!C${u.row}`, values: [[LABEL]] },
    { range: `${targetMonth}!D${u.row}`, values: [[u.amount]] },
  ]));
  const balData = [];
  if (savingsBal != null) balData.push({ range: `${targetMonth}!I10`, values: [[savingsBal]] });
  if (checkingBal != null) balData.push({ range: `${targetMonth}!I9`, values: [[checkingBal]] });
  await s.spreadsheets.values.batchUpdate({ spreadsheetId: SID, requestBody: { valueInputOption: 'USER_ENTERED', data: [...revData, ...recData, ...balData] } });

  if (expFresh.length) {
    const start = layout.firstExpenseRow, end = start + expFresh.length - 1;
    await s.spreadsheets.values.update({ spreadsheetId: SID, range: `${targetMonth}!A${start}:G${end}`, valueInputOption: 'USER_ENTERED', requestBody: { values: expFresh } });
  }

  const reqs = [];
  const colorRange = (r0, r1) => reqs.push({ repeatCell: { range: { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: COLOR } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
  revFresh.forEach((_, i) => colorRange(revRow - 1 + i, revRow + i));
  recurringUpdates.forEach((u) => { reqs.push({ repeatCell: { range: { sheetId, startRowIndex: u.row - 1, endRowIndex: u.row, startColumnIndex: 0, endColumnIndex: 4 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }); colorRange(u.row - 1, u.row); });
  if (expFresh.length) colorRange(layout.firstExpenseRow - 1, layout.firstExpenseRow - 1 + expFresh.length);
  if (reqs.length) await s.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: reqs } });

  return { month: targetMonth, written: expFresh.length, revenue: revFresh.length, recurring: recurringUpdates.length, flagged: flagged.length,
    rows: expFresh.map((r) => ({ date: r[0], merchant: r[1], amount: r[3], cat: r[5], sub: r[6] })) };
}

module.exports = { runBankMonth };
