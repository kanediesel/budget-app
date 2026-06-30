// Sync orchestrator. Runs the card sync (+ USAA bank) for the relevant month(s).
// Month-boundary safety: always do the current month; in the first 4 days of a month also
// do the previous one, so a charge bought late last month (posting now) still lands where
// it was bought. Dedup makes the overlap safe. Returns a structured summary.
const H = require('./helpers');
const { runCardsMonth } = require('./cards');
const { runBankMonth } = require('./bank');
const ledger = require('../lib/ledger');

function targetMonths(now) {
  const out = [{ name: H.MONTHS[now.getMonth()], year: now.getFullYear() }];
  if (now.getDate() <= 4) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    out.unshift({ name: H.MONTHS[prev.getMonth()], year: prev.getFullYear() });
  }
  return out;
}

// opts: { scope: 'cards'|'all' (default 'all'), dry: bool, months: [{name,year}] override }
async function runSync(opts = {}) {
  const scope = opts.scope || 'all';
  const dry = !!opts.dry;
  const now = opts.now ? new Date(opts.now) : new Date();
  const months = opts.months || targetMonths(now);

  const result = { startedAt: now.toISOString(), scope, dry, cards: [], bank: [] };
  for (const m of months) {
    try { result.cards.push(await runCardsMonth(m.name, { dry })); }
    catch (e) { result.cards.push({ month: m.name, error: e.message, written: 0 }); }
    if (scope === 'all') {
      try { result.bank.push(await runBankMonth(m.name, { year: m.year, dry })); }
      catch (e) { result.bank.push({ month: m.name, error: e.message, written: 0 }); }
    }
  }

  const cardsWritten = result.cards.reduce((a, c) => a + (c.written || 0), 0);
  const bankWritten = result.bank.reduce((a, c) => a + (c.written || 0), 0);
  result.totalWritten = cardsWritten + bankWritten;
  // collect any items that need a Plaid re-login (update mode), de-duped by label
  const reauth = {};
  [...result.cards, ...result.bank].forEach((r) => (r.needsReauth || []).forEach((x) => { reauth[x.label] = x.code; }));
  result.needsReauth = Object.entries(reauth).map(([label, code]) => ({ label, code }));
  result.summary = `${dry ? '[dry] ' : ''}${cardsWritten} card + ${bankWritten} bank row(s) across ${months.map((m) => m.name).join(', ')}` +
    (result.needsReauth.length ? ` — needs re-login: ${result.needsReauth.map((r) => r.label).join(', ')}` : '');

  if (!dry && result.totalWritten) ledger.bust(); // chat agent + any cache should see new rows
  return result;
}

module.exports = { runSync };
