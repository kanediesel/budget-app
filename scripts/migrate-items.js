// One-time: copy the local pipeline/items.json (Plaid access tokens + cursors) into the
// Supabase `plaid_items` table so the server-side sync can use them.
// Requires the plaid_items table to exist (run supabase-schema.sql first) and these env:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/migrate-items.js
const fs = require('fs');
const path = require('path');
const { upsertItem } = require('../sync/items');

(async () => {
  const itemsPath = path.join(__dirname, '..', '..', 'pipeline', 'items.json');
  if (!fs.existsSync(itemsPath)) { console.error('Not found:', itemsPath); process.exit(1); }
  const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  if (!Array.isArray(items) || !items.length) { console.error('items.json empty'); process.exit(1); }
  for (const it of items) {
    await upsertItem({ label: it.label, access_token: it.access_token, cursor: it.cursor, accounts: it.accounts || [] });
    console.log('  migrated', it.label, '(' + (it.accounts || []).length + ' account(s), cursor ' + (it.cursor ? 'set' : 'none') + ')');
  }
  console.log('Done — migrated', items.length, 'item(s) into Supabase plaid_items.');
  process.exit(0);
})().catch((e) => { console.error('MIGRATE ERROR:', e.message); process.exit(1); });
