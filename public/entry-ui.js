// Manual "Add transaction" modal — writes a line item to the month tab.
import { refreshBudget } from '/budget-ui.js';

const $ = (s) => document.querySelector(s);
let tax = null; // {categories, accounts, vacationOpen}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function openAdd() {
  if (!tax) {
    try { tax = await (await fetch('/api/entry/taxonomy')).json(); }
    catch { $('#addMsg').textContent = 'Could not load categories.'; }
  }
  if (tax) buildForm();
  $('#addModal').hidden = false;
}
function closeAdd() { $('#addModal').hidden = true; $('#addMsg').textContent = ''; }

function buildForm() {
  $('#fDate').value = todayLocal();
  $('#fMerchant').value = '';
  $('#fAmount').value = '';
  fill($('#fAccount'), tax.accounts);
  fill($('#fCategory'), Object.keys(tax.categories));
  $('#fCategory').onchange = renderSub;
  renderSub();
}
function fill(sel, items) {
  sel.innerHTML = '';
  items.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
}
function renderSub() {
  const cat = $('#fCategory').value;
  const subs = tax.categories[cat] || [];
  const wrap = $('#fSubWrap');
  if (cat === 'Vacation') {
    // open list — pick an existing trip or type a new one
    wrap.innerHTML = `<input id="fSub" type="text" list="vacTrips" placeholder="trip name" />
      <datalist id="vacTrips">${subs.map((s) => `<option value="${s}">`).join('')}</datalist>`;
  } else {
    wrap.innerHTML = `<select id="fSub">${subs.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>`;
  }
}

async function save() {
  const body = {
    date: $('#fDate').value,
    merchant: $('#fMerchant').value.trim(),
    amount: $('#fAmount').value,
    account: $('#fAccount').value,
    category: $('#fCategory').value,
    subcategory: ($('#fSub') && $('#fSub').value || '').trim(),
  };
  if (!body.date || !body.merchant || !body.amount) { $('#addMsg').textContent = 'Date, merchant, and amount are required.'; return; }
  $('#addSave').disabled = true; $('#addMsg').textContent = 'Saving…';
  try {
    const r = await fetch('/api/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Save failed');
    closeAdd();
    refreshBudget();
  } catch (e) { $('#addMsg').textContent = e.message; } finally { $('#addSave').disabled = false; }
}

$('#addCancel')?.addEventListener('click', closeAdd);
$('#addSave')?.addEventListener('click', save);
