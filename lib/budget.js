// Budget aggregation. Routes by period:
//   current year  -> the monthly tab (June, March, …) in the live sheet
//   <= last year  -> the consolidated "2019-Present" tab, filtered by year+month
const sheets = require('./sheets');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Food splits into two budgets; these subcats are "eating out", the rest of Food is "grocery".
const EATING_OUT_SUBS = new Set(['Eating Out', 'Drinks', 'Drinks Out', 'Convenience']);

function bucketFor(cat, sub) {
  if (cat === 'Food') return EATING_OUT_SUBS.has(sub) ? 'eatingOut' : 'grocery';
  if (cat === 'Entertainment') return 'entertainment';
  if (cat === 'Vacation') return 'vacation';
  return null;
}
const parseMD = (s) => { const m = String(s || '').match(/(\d+)\/(\d+)\/(\d+)/); return m ? { mo: +m[1], day: +m[2], yr: +m[3] } : null; };
const money = (v) => { const n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };

async function summary(year, month) {
  const now = new Date();
  const curYear = now.getFullYear();
  const isCurrentMonth = year === curYear && month === (now.getMonth() + 1);

  let rows, col, filterByDate;
  if (year >= curYear) {
    // monthly tab: A=Date B=Merchant C=Notes D=Expenses E=Revenue F=Category G=Sub
    rows = await sheets.readRange(`${MONTHS[month - 1]}!A1:G400`);
    col = { date: 0, exp: 3, cat: 5, sub: 6 };
    filterByDate = false;
  } else {
    // consolidated ledger: A=Date B=Merchant C=Expenses D=Revenue E=Category F=Sub
    rows = await sheets.readRange(`2019-Present!A2:F20000`);
    col = { date: 0, exp: 2, cat: 4, sub: 5 };
    filterByDate = true;
  }

  const spend = { grocery: 0, eatingOut: 0, entertainment: 0, vacation: 0 };
  for (const r of rows) {
    const cat = (r[col.cat] || '').trim();
    if (!cat || cat === 'Revenue' || cat === 'Category') continue;
    if (filterByDate) { const d = parseMD(r[col.date]); if (!d || d.yr !== year || d.mo !== month) continue; }
    const b = bucketFor(cat, (r[col.sub] || '').trim());
    if (!b) continue;
    spend[b] += money(r[col.exp]);
  }
  Object.keys(spend).forEach((k) => { spend[k] = Math.round(spend[k] * 100) / 100; });

  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    year, month, monthName: MONTHS[month - 1], source: year >= curYear ? 'monthly-tab' : '2019-Present',
    isCurrentMonth, dayOfMonth: isCurrentMonth ? now.getDate() : daysInMonth, daysInMonth,
    spend,
  };
}

module.exports = { summary, MONTHS };
