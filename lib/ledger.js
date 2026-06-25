// Normalized transaction ledger for the chat agent.
// Reads BOTH layouts and flattens them to one record shape so the agent can
// reason across the whole history with one query tool:
//   current-year monthly tabs:  A=Date B=Merchant C=Notes D=Expenses E=Revenue F=Category G=Sub
//   "2019-Present" ledger:       A=Date B=Merchant C=Expenses D=Revenue E=Category F=Sub
// Cached in-memory (5 min) so repeated chat questions don't re-read 13k rows each time.
const sheets = require('./sheets');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const parseMD = (s) => { const m = String(s || '').match(/(\d+)\/(\d+)\/(\d+)/); return m ? { mo: +m[1], day: +m[2], yr: +m[3] } : null; };
const money = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const pad = (n) => String(n).padStart(2, '0');

function rec(yr, mo, day, merchant, expense, revenue, category, subcategory, note, source) {
  return {
    iso: `${yr}-${pad(mo)}-${pad(day)}`, year: yr, month: mo, day,
    merchant: String(merchant || '').trim(), note: String(note || '').trim(),
    expense: Math.round(money(expense) * 100) / 100, revenue: Math.round(money(revenue) * 100) / 100,
    category: String(category || '').trim(), subcategory: String(subcategory || '').trim(), source,
  };
}
const isHeaderCat = (c) => { const t = (c || '').trim().toLowerCase(); return !t || t === 'category'; };

async function build() {
  const { tabs } = await sheets.meta();
  const out = [];

  // current-year monthly tabs (whatever month tabs exist in the sheet)
  const monthTabs = tabs.filter((t) => MONTHS.includes(t));
  const monthGrids = await Promise.all(monthTabs.map((t) => sheets.readRange(`${t}!A1:G400`).catch(() => [])));
  monthGrids.forEach((rows) => {
    for (const r of rows) {
      const d = parseMD(r[0]); const cat = r[5];
      if (!d || isHeaderCat(cat)) continue;
      const isRev = cat.trim().toLowerCase() === 'revenue';
      out.push(rec(d.yr, d.mo, d.day, r[1], isRev ? 0 : r[3], isRev ? r[4] : 0, cat, r[6], r[2], 'monthly'));
    }
  });

  // consolidated historical ledger
  const hist = await sheets.readRange('2019-Present!A2:F20000').catch(() => []);
  for (const r of hist) {
    const d = parseMD(r[0]); const cat = r[4];
    if (!d || isHeaderCat(cat)) continue;
    const isRev = cat.trim().toLowerCase() === 'revenue';
    out.push(rec(d.yr, d.mo, d.day, r[1], isRev ? 0 : r[2], isRev ? r[3] : 0, cat, r[5], '', 'history'));
  }
  return out;
}

let _cache = null, _at = 0;
const TTL = 5 * 60 * 1000;

async function load(force) {
  if (!force && _cache && (Date.now() - _at) < TTL) return _cache;
  _cache = await build(); _at = Date.now();
  return _cache;
}
const bust = () => { _cache = null; };

// summary the agent's system prompt can use to orient (range + totals)
async function overview() {
  const rows = await load();
  const years = rows.map((r) => r.year).filter(Boolean);
  return { rows: rows.length, minYear: Math.min(...years), maxYear: Math.max(...years) };
}

module.exports = { load, bust, overview };
