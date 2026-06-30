// Entry point for the Render Cron Job (daily account sync). Runs cards + USAA bank for the
// current month (and the prior month during the first days of a month), then exits.
// Env (Plaid, Google, Supabase, Anthropic, SHEET_ID) comes from the Render environment.
const { runSync } = require('./sync');

(async () => {
  console.log('[cron-sync] starting', new Date().toISOString());
  const result = await runSync({ scope: 'all' });
  console.log('[cron-sync] done:', result.summary);
  if (result.needsReauth && result.needsReauth.length) console.warn('[cron-sync] NEEDS RE-LOGIN (Plaid update mode):', result.needsReauth.map((r) => `${r.label} (${r.code})`).join(', '));
  for (const c of result.cards) console.log('  cards', c.month + ':', 'written', c.written, '| recurring', c.recurring, c.error ? '| ERROR ' + c.error : '');
  for (const b of result.bank) console.log('  bank ', b.month + ':', 'written', b.written, b.skipped ? '| ' + b.skipped : '', b.error ? '| ERROR ' + b.error : '');
  process.exit(0);
})().catch((e) => { console.error('[cron-sync] ERROR:', e.message); process.exit(1); });
