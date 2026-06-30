// "Sync now" button — triggers the server-side Plaid sync (same engine as the daily cron).
import { refreshBudget } from '/budget-ui.js';

const $ = (s) => document.querySelector(s);

async function runSync() {
  const btn = $('#syncBtn'), st = $('#syncStatus');
  if (!btn) return;
  btn.disabled = true;
  st.textContent = 'Syncing… pulling cards + bank and categorizing (can take up to a minute)';
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'sync failed');
    const reauth = (d.needsReauth && d.needsReauth.length) ? `  ⚠ Reconnect needed: ${d.needsReauth.map((r) => r.label).join(', ')}` : '';
    if (d.totalWritten) {
      st.textContent = `Added ${d.totalWritten} new transaction(s).` + reauth;
      refreshBudget();
    } else {
      st.textContent = (reauth ? 'Nothing new.' + reauth : 'All caught up — nothing new to add.');
    }
  } catch (e) {
    st.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

$('#syncBtn')?.addEventListener('click', runSync);
