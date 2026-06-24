// Budget app server (Render Web Service): serves the PWA + API routes.
// Secrets (Supabase service role, Google key, Plaid, Anthropic) live here, never on the phone.
const express = require('express');
const path = require('path');
const app = express();
const PUBLIC = path.join(__dirname, 'public');

app.use(express.json({ limit: '12mb' })); // receipt images etc. later

// --- API routes (more land here: /api/sheet, /api/receipt, /api/chat, /api/auth ...) ---
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// --- static PWA ---
app.use(express.static(PUBLIC, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); // always revalidate the SW
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
  },
}));

// SPA fallback for non-API GETs
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Budget app on :' + PORT));
