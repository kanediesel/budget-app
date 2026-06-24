// Minimal service worker — makes the app installable + caches the shell for fast/offline load.
// Bump CACHE when shell assets change.
const CACHE = 'budget-shell-v2';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js',
  '/manifest.webmanifest', '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // never cache API calls — always go to network
  if (url.pathname.startsWith('/api/')) return;
  // cache-first for shell, fall back to network
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
