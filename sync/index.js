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
    result.cards.push(await runCardsMonth(m.name, { dry }));
    if (scope === 'all') result.bank.push(await runBankMonth(m.name, { year: m.year, dry }));
  }

  const cardsWritten = result.cards.reduce((a, c) => a + (c.written || 0), 0);
  const bankWritten = result.bank.reduce((a, c) => a + (c.written || 0), 0);
  result.totalWritten = cardsWritten + bankWritten;
  result.summary = `${dry ? '[dry] ' : ''}${cardsWritten} card + ${bankWritten} bank row(s) across ${months.map((m) => m.name).join(', ')}`;

  if (!dry && result.totalWritten) ledger.bust(); // chat agent + any cache should see new rows
  return result;
}

module.exports = { runSync };
