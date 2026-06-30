// "Sync now" button — triggers the server-side Plaid sync and lists exactly what it added.
import { refreshBudget } from '/budget-ui.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shortDate = (d) => String(d || '').replace(/\/\d{4}$/, ''); // 6/27/2026 -> 6/27

function collectRows(d) {
  const rows = [];
  (d.cards || []).forEach((c) => (c.rows || []).forEach((r) => rows.push({ ...r, card: r.card || '' })));
  (d.bank || []).forEach((b) => (b.rows || []).forEach((r) => rows.push({ ...r, card: r.card || 'USAA' })));
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function render(d) {
  const host = $('#syncResult'); if (!host) return;
  const rows = collectRows(d);
  let html = '';
  if (d.needsReauth && d.needsReauth.length) {
    html += `<div class="sync-warn">⚠ Reconnect needed: ${esc(d.needsReauth.map((r) => r.label).join(', '))} — tap to fix from a browser.</div>`;
  }
  if (!rows.length) {
    host.innerHTML = html || '';
    return;
  }
  const blanks = rows.filter((r) => !r.cat).length;
  html += `<div class="sync-rows-head">Added ${rows.length}${blanks ? ` · ${blanks} need a category` : ''}</div>`;
  html += rows.map((r) => {
    const catTxt = r.cat ? `${esc(r.cat)}${r.sub ? '/' + esc(r.sub) : ''}` : '⚠ needs category';
    return `<div class="syncrow${r.cat ? '' : ' blank'}">
      <span class="sr-d">${esc(shortDate(r.date))}</span>
      <span class="sr-m">${esc(r.merchant || '')}</span>
      <span class="sr-a">$${Number(r.amount || 0).toFixed(2)}</span>
      <span class="sr-c">${esc(r.card || '')}</span>
      <span class="sr-cat">${catTxt}</span>
    </div>`;
  }).join('');
  host.innerHTML = html;
}

async function runSync() {
  const btn = $('#syncBtn'), st = $('#syncStatus');
  if (!btn) return;
  btn.disabled = true;
  if ($('#syncResult')) $('#syncResult').innerHTML = '';
  st.textContent = 'Syncing… pulling cards + bank and categorizing (can take up to a minute)';
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'sync failed');
    st.textContent = d.totalWritten ? `Added ${d.totalWritten} new transaction(s).` : 'All caught up — nothing new to add.';
    render(d);
    if (d.totalWritten) refreshBudget();
  } catch (e) {
    st.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

$('#syncBtn')?.addEventListener('click', runSync);
