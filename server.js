// Budget app server (Render Web Service): serves the PWA + API routes.
// Secrets (Supabase service key, Google key, session secret) live here, never on the phone.
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cfg = require('./lib/config');

const app = express();
const PUBLIC = path.join(__dirname, 'public');

app.set('trust proxy', 1); // Render is behind a proxy (needed for secure cookies)
app.use(express.json({ limit: '12mb' })); // receipt images later
app.use(cookieParser());

// --- API ---
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use('/api/auth', require('./api/auth'));
app.use('/api/sheet', require('./api/sheet'));
app.use('/api/budget', require('./api/budget'));

// --- static PWA ---
app.use(express.static(PUBLIC, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  },
}));

// SPA fallback for non-API GETs
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

app.listen(cfg.PORT, () => console.log('Budget app on :' + cfg.PORT + (cfg.isProd ? ' (prod)' : '')));
