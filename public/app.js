// PWA shell logic. No framework — vanilla ES modules.
const $ = (s) => document.querySelector(s);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIosSafari = /iP(hone|ad|od)/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);

// ---- service worker ----
let swOK = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => { swOK = true; mark('sw', true); }).catch(() => mark('sw', false));
} else { mark('sw', false); }

// ---- install nudge: only in a Safari tab (not installed), iOS only ----
if (isIosSafari && !isStandalone && localStorage.getItem('nudgeDismissed') !== '1') {
  const n = $('#installNudge'); if (n) n.hidden = false;
}
$('#installDismiss')?.addEventListener('click', () => { $('#installNudge').hidden = true; localStorage.setItem('nudgeDismissed', '1'); });

// ---- lock / unlock (placeholder; real passkey 2FA is next) ----
function showApp(show) { $('#lock').hidden = show; $('#app').hidden = !show; if (show) runChecks(); }
$('#unlockBtn')?.addEventListener('click', () => showApp(true));
$('#lockBtn')?.addEventListener('click', () => showApp(false));

// ---- shell self-checks (so we can verify on the real iPhone) ----
function mark(key, ok) {
  const li = document.querySelector(`.checks li[data-k="${key}"]`);
  if (li) li.className = ok ? 'pass' : 'fail';
}
async function runChecks() {
  mark('standalone', isStandalone);
  // safe-area present? read the computed inset (top will be > 0 on a notched iPhone in standalone)
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);';
  document.body.appendChild(probe);
  const inset = probe.getBoundingClientRect().height; probe.remove();
  mark('safearea', inset > 0 || !isIosSafari); // pass off-device too, so it's not a false alarm on desktop
  mark('sw', swOK);
  mark('online', navigator.onLine);
  try { const r = await fetch('/api/health'); mark('api', r.ok); } catch { mark('api', false); }
}
window.addEventListener('online', () => mark('online', true));
window.addEventListener('offline', () => mark('online', false));
