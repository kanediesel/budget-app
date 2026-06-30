// PWA shell + passkey (Face ID) auth. Vanilla ES module.
import { startRegistration, startAuthentication } from 'https://esm.sh/@simplewebauthn/browser@13';
import { initBudget } from '/budget-ui.js';
import { openAdd } from '/entry-ui.js';
import { openReceipt } from '/receipt-ui.js';
import { openChat } from '/chat-ui.js';
import '/sync-ui.js';
document.querySelector('#tabAdd')?.addEventListener('click', openAdd);
document.querySelector('#tabReceipt')?.addEventListener('click', openReceipt);
document.querySelector('#tabChat')?.addEventListener('click', openChat);

const $ = (s) => document.querySelector(s);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIosSafari = /iP(hone|ad|od)/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
const msg = (t) => { const m = $('#authMsg'); if (m) m.textContent = t || ''; };
const api = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// ---- service worker ----
let swOK = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => { swOK = true; mark('sw', true); }).catch(() => mark('sw', false));
} else { mark('sw', false); }

// ---- install nudge (iOS Safari tab only) ----
if (isIosSafari && !isStandalone && localStorage.getItem('nudgeDismissed') !== '1') {
  const n = $('#installNudge'); if (n) n.hidden = false;
}
$('#installDismiss')?.addEventListener('click', () => { $('#installNudge').hidden = true; localStorage.setItem('nudgeDismissed', '1'); });

// ---- auth ----
function showApp(user) {
  $('#lock').hidden = !!user ? true : false;
  $('#app').hidden = !!user ? false : true;
  if (user) { $('#who').textContent = user.email || ''; runChecks(); initBudget(); }
}
async function refreshSession() {
  try { const r = await fetch('/api/auth/me'); if (r.ok) { const { user } = await r.json(); showApp(user); return; } } catch {}
  showApp(null);
}

$('#loginBtn')?.addEventListener('click', async () => {
  msg('Waking the server…'); $('#loginBtn').disabled = true;
  try {
    const optRes = await api('/api/auth/login/options');
    if (!optRes.ok) throw new Error('Could not start sign-in');
    const options = await optRes.json();
    msg('Confirm with Face ID…');
    const assertion = await startAuthentication({ optionsJSON: options });
    const verify = await api('/api/auth/login/verify', assertion);
    const data = await verify.json();
    if (!verify.ok) throw new Error(data.error || 'Sign-in failed');
    msg(''); showApp(data.user);
  } catch (e) {
    msg(e.message === 'unknown passkey' ? 'No passkey found — set one up below.' : (e.message || 'Sign-in canceled'));
  } finally { $('#loginBtn').disabled = false; }
});

$('#registerBtn')?.addEventListener('click', async () => {
  const email = ($('#regEmail')?.value || '').trim().toLowerCase();
  if (!email) { msg('Enter your email first.'); return; }
  msg('Setting up…'); $('#registerBtn').disabled = true;
  try {
    const optRes = await api('/api/auth/register/options', { email });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || 'Setup failed');
    msg('Create the passkey with Face ID…');
    const attestation = await startRegistration({ optionsJSON: options });
    const verify = await api('/api/auth/register/verify', attestation);
    const data = await verify.json();
    if (!verify.ok) throw new Error(data.error || 'Setup failed');
    msg(''); showApp(data.user);
  } catch (e) { msg(e.message || 'Setup canceled'); } finally { $('#registerBtn').disabled = false; }
});

$('#lockBtn')?.addEventListener('click', async () => { try { await api('/api/auth/logout'); } catch {} showApp(null); });

// ---- shell self-checks ----
function mark(key, ok) { const li = document.querySelector(`.checks li[data-k="${key}"]`); if (li) li.className = ok ? 'pass' : 'fail'; }
async function runChecks() {
  mark('standalone', isStandalone);
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);';
  document.body.appendChild(probe);
  const inset = probe.getBoundingClientRect().height; probe.remove();
  mark('safearea', inset > 0 || !isIosSafari);
  mark('sw', swOK);
  mark('online', navigator.onLine);
  try { mark('api', (await fetch('/api/health')).ok); } catch { mark('api', false); }
  try { mark('sheet', (await fetch('/api/sheet/ping')).ok); } catch { mark('sheet', false); }
}
window.addEventListener('online', () => mark('online', true));
window.addEventListener('offline', () => mark('online', false));

refreshSession();
