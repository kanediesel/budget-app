// Server-side sync helpers — ported from the local pipeline so the SAME pull/categorize/
// write logic runs on Render (daily cron + on-demand button). Uses the app's env-based
// Sheets client (GOOGLE_SERVICE_ACCOUNT_JSON), not a local key file.
const sheets = require('../lib/sheets');
const cfg = require('../lib/config');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthName = (iso) => MONTHS[parseInt(iso.split('-')[1], 10) - 1];
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${y}`; };
const isoFromSheet = (s) => { const m = String(s).match(/(\d+)\/(\d+)\/(\d+)/); if (!m) return null; return `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`; };
const cleanName = (t) => (t.merchant_name || t.name);
// file a charge under when it was BOUGHT (authorized_date), not when it posted.
const txnDate = (t) => t.authorized_date || t.date;
const daysApart = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
const normMerchant = (m) => String(m).toLowerCase()
  .replace(/\([^)]*\)/g, ' ').replace(/[#*].*$/, ' ').replace(/\d+/g, ' ')
  .replace(/[^a-z& ]/g, ' ')
  .replace(/\b(via|chase|amex|citi|capital one|usaa|bilt|apple card|payment|purchase|pos|debit|llc|inc|com)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };
const dedupKey = (iso, amount) => `${iso}|${Number(amount).toFixed(2)}`;

function isPayment(t) {
  const p = t.personal_finance_category || {};
  const name = t.name || '';
  if (p.primary === 'LOAN_PAYMENTS' || p.detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return true;
  if (/\bPYMT\b/i.test(name)) return true;
  if (p.detailed === 'INCOME_RENTAL' || /^payment - bilt/i.test(name)) return true;
  return false;
}
const isUnguessable = (p) => p.needsSplit || /\*{4,}/.test(cleanName(p.txn)) || /^[\*_\s]+$/.test(cleanName(p.txn));

const CARD_COLORS = {
  'BILT': '#990000', 'Citi': '#ff00ff', 'Marriott': '#b45f06', 'Apple': '#1155cc',
  'USAA': '#38761d', 'A-Capital One': '#ff0000', 'B-Capital One': '#45818e',
};
const hexToRgb = (h) => ({ red: parseInt(h.slice(1,3),16)/255, green: parseInt(h.slice(3,5),16)/255, blue: parseInt(h.slice(5,7),16)/255 });

const isGrey = (bg) => { if (!bg) return false; const r=bg.red||0,g=bg.green||0,b=bg.blue||0; return r>0.3&&r<0.55&&Math.abs(r-g)<0.1&&Math.abs(g-b)<0.1; };

// Rich layout discovery (recurring block + expense keys + split markers + first empty row).
async function findLayout(tab) {
  const s = await sheets.client();
  const meta = await s.spreadsheets.get({ spreadsheetId: cfg.SHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const sh = meta.data.sheets.find((x) => x.properties.title === tab);
  if (!sh) return null;
  const sheetId = sh.properties.sheetId;
  const res = await s.spreadsheets.get({
    spreadsheetId: cfg.SHEET_ID, ranges: [`${tab}!A1:G200`], includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold)',
  });
  const rows = res.data.sheets[0].data[0].rowData || [];
  const greyRows = [];
  rows.forEach((row, i) => { const c = (row.values || [])[0]; if (c && isGrey(c.userEnteredFormat && c.userEnteredFormat.backgroundColor)) greyRows.push(i + 1); });
  const grey1 = greyRows[0], grey2 = greyRows[1];
  const recurring = {};
  const existingKeys = new Set();
  for (let r = grey1 + 1; r < grey2; r++) {
    const cells = (rows[r - 1] && rows[r - 1].values) || [];
    const v = (j) => (cells[j] && cells[j].formattedValue) || '';
    const name = v(1).trim(); if (!name) continue;
    const bold = !!(cells[0] && cells[0].userEnteredFormat && cells[0].userEnteredFormat.textFormat && cells[0].userEnteredFormat.textFormat.bold);
    recurring[name.toLowerCase()] = { row: r, name, amount: num(v(3)), cat: v(5), sub: v(6), bold };
    if (bold) { const iso = isoFromSheet(v(0)); if (iso) existingKeys.add(dedupKey(iso, num(v(3)))); }
  }
  const expenseKeys = existingKeys;
  const splitMarkers = [];
  let firstExpenseRow = grey2 + 1;
  for (let r = grey2 + 1; r <= rows.length; r++) {
    const cells = (rows[r - 1] && rows[r - 1].values) || [];
    const v = (j) => (cells[j] && cells[j].formattedValue) || '';
    if (v(0) || v(1)) {
      const iso = isoFromSheet(v(0));
      if (iso) {
        expenseKeys.add(dedupKey(iso, num(v(3))));
        const nm = String(v(2)).match(/\$\s*(\d+\.\d{2})/);
        const noteTotal = nm ? parseFloat(nm[1]) : null;
        if (noteTotal) { expenseKeys.add(dedupKey(iso, noteTotal)); splitMarkers.push({ iso, merchant: (v(1) || '').toLowerCase(), total: noteTotal }); }
      }
      firstExpenseRow = r + 1;
    } else { firstExpenseRow = r; break; }
  }
  return { sheetId, grey1, grey2, recurring, firstExpenseRow, expenseKeys, splitMarkers };
}

module.exports = { MONTHS, monthName, fmtDate, isoFromSheet, cleanName, txnDate, daysApart, normMerchant, num, dedupKey, isPayment, isUnguessable, CARD_COLORS, hexToRgb, findLayout };
