// Categorizer (server copy of the validated local engine). Same prompt + web search +
// merchant-history hints; the merchant memory is BUILT FROM THE LIVE SHEET at runtime
// (cached 1h) rather than a committed merchant-memory.json file.
const Anthropic = require('@anthropic-ai/sdk');
const cfg = require('../lib/config');
const sheets = require('../lib/sheets');
const H = require('./helpers');
const taxonomy = require('../lib/taxonomy.json');
const taxonomyText = JSON.stringify(taxonomy);

const RETIRED = new Set(['Kia', 'Jeep', 'BMW', 'F150', 'Paris 2024', 'Child Care']);
let MEMORY = null, MEM_AT = 0;
const MEM_TTL = 60 * 60 * 1000;

// learn {normMerchant: {category, subcategory, count, subPurity, alts}} from 2019-Present
async function buildMemory() {
  const rows = await sheets.readRange('2019-Present!A2:F13000').catch(() => []);
  const M = {};
  for (const r of rows) {
    const merch = r[1], cat = (r[4] || '').trim(), sub = (r[5] || '').trim();
    if (!merch || !cat || RETIRED.has(cat)) continue;
    const n = H.normMerchant(merch); if (!n) continue;
    (M[n] ||= { count: 0, pairs: {} });
    M[n].count++; const k = cat + '||' + sub; M[n].pairs[k] = (M[n].pairs[k] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const memory = {};
  for (const [n, d] of Object.entries(M)) {
    if (d.count < 3) continue;
    const [pairKey, pairN] = top(d.pairs)[0];
    const [pCat, pSub] = pairKey.split('||');
    memory[n] = { category: pCat, subcategory: pSub, count: d.count, subPurity: +(pairN / d.count).toFixed(2), alts: top(d.pairs).slice(0, 3).map(([k, c]) => k.replace('||', '/') + ':' + c) };
  }
  return memory;
}
async function memory() {
  if (MEMORY && (Date.now() - MEM_AT) < MEM_TTL) return MEMORY;
  MEMORY = await buildMemory(); MEM_AT = Date.now();
  return MEMORY;
}

function historyHints(txns, mem) {
  const lines = [], seen = new Set();
  for (const t of txns) {
    const n = H.normMerchant(H.cleanName(t));
    if (!n || seen.has(n) || !mem[n]) continue;
    seen.add(n);
    const m = mem[n];
    const strong = m.subPurity >= 0.85 && m.count >= 5;
    lines.push(`- "${H.cleanName(t)}" → ${m.category}/${m.subcategory} (${Math.round(m.subPurity*100)}% of ${m.count}${strong ? ', STRONG' : '; alts ' + m.alts.join(', ')})`);
  }
  return lines.join('\n');
}

async function categorize(txns, recurringNames) {
  if (!txns.length) return [];
  const mem = await memory();
  const items = txns.map((t, i) => ({
    id: i, date: t.date, name: t.name, merchant: t.merchant_name || null, amount: t.amount,
    plaid: (t.personal_finance_category || {}).detailed || (t.personal_finance_category || {}).primary || null,
  }));
  const hints = historyHints(txns, mem);

  const sys = `You categorize credit-card transactions for Brian Maucere's household budget into HIS taxonomy.

TAXONOMY (the ONLY allowed category + sub-category values):
${taxonomyText}

HARD RULES:
- Output ONLY a (category, subcategory) pair that exists in the taxonomy. Never invent a subcategory.
- Merchant name is NOT the subcategory. Store names (Publix, CVS, Target, Costco, Amazon, Wal-Mart, Sprouts, Whole Foods, ALDI) are valid subcategories ONLY under "Food" = groceries/food bought there. What was bought decides the category: toiletries at Publix => Health/Toiletries; an Rx at CVS => Health/Rx.
- Vacation subcategories are TRIP NAMES. If transactions cluster by an out-of-town location + date range, treat them as a trip and set tripName (reuse an existing trip name if it fits, else propose a concise new one). All trip spend rolls up under Vacation with that trip name.
- This is a credit card: NEVER output Revenue. A negative amount is a refund/credit — keep as a negative expense in the most likely category.
- If a merchant is unfamiliar, abbreviated, or garbled, USE WEB SEARCH to identify it before categorizing. Use the location hints in the raw name.

RECURRING BILLS pre-listed in the sheet (if a transaction IS one, report which by exact name):
${recurringNames.join(', ')}

BRIAN'S HISTORICAL CATEGORIZATION for merchants in this batch — match these to stay consistent with how he files them, UNLESS the transaction context clearly differs (a trip, or a different item bought). "STRONG" = follow it almost always:
${hints || '(no history for these merchants)'}

For EACH input transaction return:
{ "id": <id>, "category": "...", "subcategory": "...", "confidence": "high|med|low",
  "recurringMatch": "<exact recurring bill name or null>", "needsSplit": <true for multi-category stores like Amazon/Target where the split is unknown>,
  "tripName": "<trip name or null>", "note": "<short reason; cite research if used>" }

Return ONLY a JSON array, no prose.`;

  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-opus-4-8', max_tokens: 12000, system: sys,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 20 }],
    messages: [{ role: 'user', content: 'Transactions:\n' + JSON.stringify(items, null, 1) }],
  });
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const plan = JSON.parse(json);
  return plan.map(p => ({ ...p, txn: txns[p.id] }));
}

module.exports = { categorize };
