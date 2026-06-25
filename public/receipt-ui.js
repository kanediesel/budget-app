// Receipt tab: photo -> AI parse -> editable split -> commit to sheet.
import { refreshBudget } from '/budget-ui.js';

const $ = (s) => document.querySelector(s);
let tax = null;       // {categories, accounts}
let parsed = null;    // last parse result

export async function openReceipt() {
  if (!tax) { try { tax = await (await fetch('/api/entry/taxonomy')).json(); } catch {} }
  parsed = null;
  $('#rcptResult').hidden = true;
  $('#rcptStatus').textContent = '';
  $('#rcptFile').value = '';
  $('#receiptModal').hidden = false;
}
const closeReceipt = () => { $('#receiptModal').hidden = true; };

// downscale on-device so the upload is small + vision is fast
function fileToBase64(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ base64: c.toDataURL('image/jpeg', quality).split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = reject; img.src = url;
  });
}

$('#rcptFile')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]; if (!file) return;
  $('#rcptStatus').textContent = 'Reading receipt…'; $('#rcptResult').hidden = true;
  try {
    const { base64, mediaType } = await fileToBase64(file);
    const r = await fetch('/api/receipt/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: base64, mediaType }) });
    parsed = await r.json();
    if (!r.ok) throw new Error(parsed.error || 'parse failed');
    renderResult(parsed);
    $('#rcptStatus').textContent = '';
  } catch (err) { $('#rcptStatus').textContent = 'Could not read it (' + err.message + '). Try again or add it manually.'; }
});

function renderResult(p) {
  $('#rcptResult').hidden = false;
  $('#rcptMerchant').textContent = p.merchant || 'Receipt';
  $('#rcptDate').value = p.date || '';
  $('#rcptTotal').textContent = '$' + Number(p.total || 0).toFixed(2);
  // account picker (default to handwriting-cash, else B-Capital One = your Apple Pay card)
  const accSel = $('#rcptAccount'); accSel.innerHTML = '';
  (tax ? tax.accounts : ['Cash', 'B-Capital One']).forEach((a) => { const o = document.createElement('option'); o.value = a; o.textContent = a; accSel.appendChild(o); });
  accSel.value = p.account || 'B-Capital One';
  // lines
  $('#rcptLines').innerHTML = '';
  (p.lines || []).forEach((l) => addLineRow(l));
  if (!(p.lines || []).length) addLineRow({ category: 'Food', subcategory: '', amount: p.total || 0 });
  updateSum();
}

function addLineRow(line) {
  const wrap = document.createElement('div'); wrap.className = 'rcpt-line' + (line.flag ? ' flagged' : '');
  const cats = tax ? Object.keys(tax.categories) : ['Food'];
  wrap.innerHTML =
    `<select class="ln-cat">${cats.map((c) => `<option ${c === line.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
     <span class="ln-sub"></span>
     <input class="ln-amt" type="number" inputmode="decimal" step="0.01" value="${Number(line.amount || 0).toFixed(2)}" />
     <button class="ln-del" aria-label="Remove">✕</button>`;
  $('#rcptLines').appendChild(wrap);
  const catSel = wrap.querySelector('.ln-cat');
  const renderSub = () => {
    const subs = (tax && tax.categories[catSel.value]) || [];
    const host = wrap.querySelector('.ln-sub');
    if (catSel.value === 'Vacation') host.innerHTML = `<input class="ln-subv" list="vacTrips2" placeholder="trip" value="${line.subcategory || ''}"/><datalist id="vacTrips2">${subs.map((s) => `<option value="${s}">`).join('')}</datalist>`;
    else host.innerHTML = `<select class="ln-subv">${subs.map((s) => `<option ${s === line.subcategory ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  };
  renderSub();
  catSel.onchange = () => { line.subcategory = ''; renderSub(); };
  wrap.querySelector('.ln-amt').addEventListener('input', updateSum);
  wrap.querySelector('.ln-del').addEventListener('click', () => { wrap.remove(); updateSum(); });
  if (line.flag) { const f = document.createElement('div'); f.className = 'tiny flagnote'; f.textContent = '⚠️ ' + (line.note || 'check this'); wrap.appendChild(f); }
}

function gatherLines() {
  return [...document.querySelectorAll('.rcpt-line')].map((w) => ({
    category: w.querySelector('.ln-cat').value,
    subcategory: (w.querySelector('.ln-subv') && w.querySelector('.ln-subv').value) || '',
    amount: Number(w.querySelector('.ln-amt').value) || 0,
  }));
}
function updateSum() {
  const sum = gatherLines().reduce((a, l) => a + l.amount, 0);
  const total = Number(parsed && parsed.total || 0);
  const ok = Math.abs(sum - total) < 0.02;
  $('#rcptSum').innerHTML = `Split total: <b>$${sum.toFixed(2)}</b> of $${total.toFixed(2)} ${ok ? '<span style="color:var(--ok)">✓</span>' : '<span style="color:var(--bad)">— will adjust to match on save</span>'}`;
}

$('#rcptAddLine')?.addEventListener('click', () => { addLineRow({ category: 'Food', subcategory: '', amount: 0 }); updateSum(); });
$('#rcptCancel')?.addEventListener('click', closeReceipt);
$('#rcptSave')?.addEventListener('click', async () => {
  const lines = gatherLines();
  if (!lines.length) { $('#rcptStatus').textContent = 'Add at least one line.'; return; }
  $('#rcptSave').disabled = true; $('#rcptStatus').textContent = 'Saving…';
  try {
    const body = { date: $('#rcptDate').value, merchant: parsed.merchant, total: parsed.total, account: $('#rcptAccount').value, lines };
    const r = await fetch('/api/receipt/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'save failed');
    $('#rcptStatus').textContent = data.replacedInPlace ? 'Split the existing charge ✓' : 'Added split ✓';
    closeReceipt(); refreshBudget();
  } catch (e) { $('#rcptStatus').textContent = e.message; } finally { $('#rcptSave').disabled = false; }
});
