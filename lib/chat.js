// Budget chat agent. claude-opus-4-8 with adaptive thinking + two tools:
//   query_ledger : filter/aggregate the household's real 2019->present transactions (exact numbers)
//   web_search   : pull outside facts (e.g. current grocery inflation) to combine with our data
// Manual agentic loop so we can run the client-side query tool and surface what it looked at.
const Anthropic = require('@anthropic-ai/sdk');
const cfg = require('./config');
const ledger = require('./ledger');
const taxonomy = require('./taxonomy.json');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const round = (n) => Math.round(n * 100) / 100;
const lc = (s) => String(s || '').toLowerCase();

// ---- the data tool, run in-memory over the normalized ledger ----
function runQuery(records, a = {}) {
  const field = a.field === 'revenue' ? 'revenue' : 'expense';
  let rows = records;
  if (a.start_date) rows = rows.filter((r) => r.iso >= a.start_date);
  if (a.end_date) rows = rows.filter((r) => r.iso <= a.end_date);
  if (a.year != null) rows = rows.filter((r) => r.year === Number(a.year));
  if (a.month != null) rows = rows.filter((r) => r.month === Number(a.month));
  if (a.categories && a.categories.length) { const s = new Set(a.categories.map(lc)); rows = rows.filter((r) => s.has(lc(r.category))); }
  if (a.subcategories && a.subcategories.length) { const s = new Set(a.subcategories.map(lc)); rows = rows.filter((r) => s.has(lc(r.subcategory))); }
  if (a.merchant_contains) { const q = lc(a.merchant_contains); rows = rows.filter((r) => lc(r.merchant).includes(q)); }
  rows = rows.filter((r) => Number(r[field]) > 0);

  const total = round(rows.reduce((s, r) => s + Number(r[field]), 0));
  if (a.mode === 'list') {
    const limit = Math.min(Number(a.limit) || 50, 200);
    const items = rows.slice().sort((x, y) => y.iso.localeCompare(x.iso)).slice(0, limit)
      .map((r) => ({ date: r.iso, merchant: r.merchant, amount: round(r[field]), category: r.category, subcategory: r.subcategory, account: r.note || undefined }));
    return { count: rows.length, total, returned: items.length, items };
  }
  const gb = a.group_by || 'none';
  if (gb === 'none') return { count: rows.length, total };
  const keyOf = (r) => gb === 'month' ? `${r.year}-${String(r.month).padStart(2, '0')}`
    : gb === 'year' ? String(r.year)
    : gb === 'category' ? (r.category || '(none)')
    : gb === 'subcategory' ? (r.subcategory || '(none)')
    : gb === 'merchant' ? (r.merchant || '(none)') : 'all';
  const m = new Map();
  rows.forEach((r) => { const k = keyOf(r); const g = m.get(k) || { key: k, total: 0, count: 0 }; g.total += Number(r[field]); g.count++; m.set(k, g); });
  const groups = [...m.values()].map((g) => ({ ...g, total: round(g.total) })).sort((x, y) => y.total - x.total);
  return { count: rows.length, total, groups };
}

const QUERY_TOOL = {
  name: 'query_ledger',
  description: 'Query Brian & Amanda\'s real household transactions (2019 to present). Use this for EVERY dollar figure, count, or trend you state — never estimate from memory. Returns exact totals. Call it multiple times to compare periods or categories.',
  input_schema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['aggregate', 'list'], description: 'aggregate = sums/counts (optionally grouped); list = individual transactions' },
      field: { type: 'string', enum: ['expense', 'revenue'], description: 'expense (default) or revenue/income' },
      start_date: { type: 'string', description: 'inclusive YYYY-MM-DD' },
      end_date: { type: 'string', description: 'inclusive YYYY-MM-DD' },
      year: { type: 'integer', description: 'filter to a single year' },
      month: { type: 'integer', description: 'filter to a single month number 1-12' },
      categories: { type: 'array', items: { type: 'string' }, description: 'category names to include (see taxonomy in the system prompt)' },
      subcategories: { type: 'array', items: { type: 'string' }, description: 'subcategory names to include' },
      merchant_contains: { type: 'string', description: 'case-insensitive substring match on the merchant name' },
      group_by: { type: 'string', enum: ['none', 'month', 'year', 'category', 'subcategory', 'merchant'], description: 'how to group aggregate results' },
      limit: { type: 'integer', description: 'max items for list mode (default 50, max 200)' },
    },
    required: ['mode'],
  },
};

function systemPrompt(ov) {
  const taxo = Object.entries(taxonomy.categories).map(([c, subs]) => `- ${c}: ${subs.join(', ')}`).join('\n');
  const now = new Date();
  return `You are the household budget assistant for Brian & Amanda Maucere. Today is ${now.toISOString().slice(0, 10)}. Their itemized budget data runs from ${ov.minYear} to ${ov.maxYear} (${ov.rows} transactions).

You answer questions about their spending and income by calling the query_ledger tool — it returns EXACT figures from their spreadsheet (the source of truth). Rules:
- For any number, total, count, average, or trend you mention, get it from query_ledger. Never guess or recall a figure. Run several queries when a question needs comparison (e.g. year over year, or category vs category).
- Compute averages/changes yourself from the exact totals the tool returns.
- Use web_search ONLY for outside facts (e.g. national inflation rates, the price of something) and then combine that with their real numbers. Cite what you found.
- Be direct and concise — this is read on a phone. Lead with the answer/number, then a short why. Use plain text, not tables, unless a few short lines help.

TAXONOMY (use these exact category/subcategory names when filtering):
${taxo}

Spending buckets (their main budgets): the Food category splits into "groceries" (Food minus the eating-out subs) and "eating out" (Food subcategories: Eating Out, Drinks, Drinks Out, Convenience). Entertainment and Vacation are their own budgets. When asked about "groceries" filter categories=["Food"] and exclude those four subs (query each subset and subtract, or use subcategories to include just the grocery stores). When asked about "eating out" use subcategories=["Eating Out","Drinks","Drinks Out","Convenience"].`;
}

// strip to plain text + simple history; cap to recent turns
function normalizeHistory(messages) {
  return (messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
}

async function ask(messages) {
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY });
  const [records, ov] = await Promise.all([ledger.load(), ledger.overview()]);
  const system = systemPrompt(ov);
  const tools = [{ type: 'web_search_20260209', name: 'web_search' }, QUERY_TOOL];

  const convo = normalizeHistory(messages);
  if (!convo.length || convo[convo.length - 1].role !== 'user') throw new Error('last message must be from the user');

  const queries = [];     // {args, result-summary} for a "what it checked" trace
  const sources = [];     // web search citations
  let rounds = 0;
  while (rounds++ < 8) {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system,
      tools,
      messages: convo,
    });

    // gather web-search sources from this response
    for (const b of resp.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const it of b.content) if (it && it.type === 'web_search_result' && it.url) sources.push({ title: it.title || it.url, url: it.url });
      }
    }

    if (resp.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: resp.content });
      const results = [];
      for (const b of resp.content) {
        if (b.type !== 'tool_use') continue;
        if (b.name === 'query_ledger') {
          let out;
          try { out = runQuery(records, b.input || {}); }
          catch (e) { out = { error: e.message }; }
          queries.push({ q: b.input, total: out.total, count: out.count });
          results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) });
        }
      }
      if (!results.length) break; // tool_use we don't handle — bail to avoid a loop
      convo.push({ role: 'user', content: results });
      continue;
    }
    if (resp.stop_reason === 'pause_turn') { convo.push({ role: 'assistant', content: resp.content }); continue; }

    // end_turn / max_tokens / refusal
    const reply = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (resp.stop_reason === 'refusal') return { reply: 'Sorry — I can\'t help with that one.', queries, sources: dedupeSources(sources) };
    return { reply: reply || '(no answer)', queries, sources: dedupeSources(sources) };
  }
  return { reply: 'That took too many steps — try narrowing the question.', queries, sources: dedupeSources(sources) };
}

function dedupeSources(list) { const seen = new Set(); return list.filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 6); }

module.exports = { ask };
