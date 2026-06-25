// Budget gauges: month/year selector + arc gauges with pace marker + tap-to-set-budget.
const $ = (s) => document.querySelector(s);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const BUDGETS = [
  { key: 'grocery', label: 'Grocery' },
  { key: 'eatingOut', label: 'Eating Out' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'vacation', label: 'Vacation' },
];
const fmt = (n) => '$' + Math.round(n).toLocaleString();
let inited = false;
let last = null;

export function initBudget() {
  if (!inited) { buildSelectors(); inited = true; }
  load();
}
export function refreshBudget() { load(); }

function buildSelectors() {
  const now = new Date();
  const mSel = $('#selMonth'), ySel = $('#selYear');
  MONTHS.forEach((m, i) => { const o = document.createElement('option'); o.value = i + 1; o.textContent = m; mSel.appendChild(o); });
  for (let y = now.getFullYear(); y >= 2019; y--) { const o = document.createElement('option'); o.value = y; o.textContent = y; ySel.appendChild(o); }
  mSel.value = now.getMonth() + 1; ySel.value = now.getFullYear();
  mSel.addEventListener('change', load); ySel.addEventListener('change', load);
}

async function load() {
  const month = $('#selMonth').value, year = $('#selYear').value;
  const el = $('#gauges'); el.innerHTML = '<p class="muted tiny">Loading…</p>';
  try {
    const r = await fetch(`/api/budget/summary?year=${year}&month=${month}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    last = await r.json();
    render(last);
  } catch (e) { el.innerHTML = '<p class="muted tiny">Could not load (' + e.message + ')</p>'; }
}

// ---- gauge geometry (semicircle, cx=100 cy=100 R=84) ----
const pt = (deg) => { const a = deg * Math.PI / 180; return [100 + 84 * Math.cos(a), 100 - 84 * Math.sin(a)]; };
function arc(v) {
  v = Math.max(0, Math.min(1, v)); if (v <= 0) return '';
  const [sx, sy] = pt(180); const [ex, ey] = pt(180 - 180 * v);
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} A 84 84 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}
function paceMark(p) {
  const ang = 180 - 180 * Math.min(p, 1); const a = ang * Math.PI / 180;
  const x1 = 100 + 72 * Math.cos(a), y1 = 100 - 72 * Math.sin(a), x2 = 100 + 94 * Math.cos(a), y2 = 100 - 94 * Math.sin(a);
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="g-pace"/>`;
}
const color = (ratio, pace) => (ratio > 1 ? '#e06a6a' : ratio > pace + 0.05 ? '#e0a64a' : '#45c4a8');

function render(data) {
  const el = $('#gauges'); el.innerHTML = '';
  const pace = data.isCurrentMonth ? data.dayOfMonth / data.daysInMonth : 1;
  BUDGETS.forEach((b) => {
    const spent = data.spend[b.key] || 0;
    const t = data.targets[b.key]; const target = t ? t.amount : 0;
    const ratio = target > 0 ? spent / target : 0;
    const col = target > 0 ? color(ratio, pace) : '#20415c';
    const card = document.createElement('div');
    card.className = 'gauge';
    card.innerHTML =
      `<div class="gauge-title">${b.label}</div>
       <svg viewBox="0 0 200 116" class="gauge-svg">
         <path d="${arc(1)}" class="g-track"/>
         ${target > 0 ? `<path d="${arc(Math.min(ratio, 1))}" class="g-val" style="stroke:${col}"/>` : ''}
         ${target > 0 && data.isCurrentMonth ? paceMark(pace) : ''}
         <text x="100" y="90" class="g-spent">${fmt(spent)}</text>
         <text x="100" y="108" class="g-sub">${target > 0 ? 'of ' + fmt(target) : 'tap to set budget'}</text>
       </svg>`;
    card.addEventListener('click', () => editTarget(b));
    el.appendChild(card);
  });
}

async function editTarget(b) {
  const cur = (last && last.targets[b.key]) ? last.targets[b.key].amount : '';
  const v = prompt(`Monthly budget for ${b.label} ($):`, cur);
  if (v === null) return;
  const amount = parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
  try {
    await fetch('/api/budget/targets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_key: b.key, amount, period: 'monthly' }),
    });
    load();
  } catch {}
}
