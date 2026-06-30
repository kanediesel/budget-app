// Plaid item store, backed by Supabase (replaces the local items.json so the sync
// can run on Render). Holds access_token + incremental cursor + account list per label.
const { db } = require('../lib/supabase');

async function loadItems() {
  const { data, error } = await db().from('plaid_items').select('label, access_token, cursor, accounts');
  if (error) throw error;
  return (data || []).map((r) => ({ label: r.label, access_token: r.access_token, cursor: r.cursor || undefined, accounts: r.accounts || [] }));
}

// persist the advanced cursor after a successful pull (so re-runs are incremental)
async function saveCursor(label, cursor) {
  const { error } = await db().from('plaid_items').update({ cursor: cursor || null, updated_at: new Date().toISOString() }).eq('label', label);
  if (error) throw error;
}

// upsert a connected item (used by the one-time migration + future connect flows)
async function upsertItem({ label, access_token, cursor, accounts }) {
  const { error } = await db().from('plaid_items').upsert({
    label, access_token, cursor: cursor || null, accounts: accounts || [], updated_at: new Date().toISOString(),
  }, { onConflict: 'label' });
  if (error) throw error;
}

module.exports = { loadItems, saveCursor, upsertItem };
