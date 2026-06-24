# Budget App

Personal household budget PWA. Node/Express web service (Render) + Supabase + Google Sheets
(source of truth) + Claude + Plaid. See ../APP-PRD.md for the product spec.

## Run locally
```
cd app
npm install
npm start            # http://localhost:3000
npm run icons        # regenerate PNG icons from public/icons/icon.svg
```

## Deploy to Render (host of record)
1. Push this repo to GitHub (your personal account — NOT the Skaled org).
2. In Render → **New → Web Service** → connect the repo. The `render.yaml` blueprint sets it up
   (Node, `npm install`, `npm start`, port from `$PORT`).
3. Add env vars in the Render dashboard when we wire features (none needed for the shell):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE`, `GOOGLE_SERVICE_ACCOUNT_JSON`,
   `SHEET_ID`, `ANTHROPIC_API_KEY`, `PLAID_CLIENT_ID`, `PLAID_SECRET`.
4. Render gives you an `https://…onrender.com` URL.

## Install + test on your iPhone (do this on the real device)
1. Open the Render URL **in Safari** (not Chrome — iOS only installs PWAs from Safari).
2. Tap **Share ▸ Add to Home Screen**. A "Budget" icon appears.
3. Launch it from the icon. You should see:
   - a clean icon, no white flash, no Safari address bar (standalone),
   - content clear of the Dynamic Island / home bar (safe areas),
   - after Unlock: shell checks all ✓ incl. **Installed to Home Screen ✓**.
4. Debugging without a Mac: append **`?debug=1`** to the URL for an on-screen console (eruda).

## Current state
- **Shell only.** Lock screen + app shell + bottom nav + self-checks. The Unlock button is a
  placeholder — real **passkey / Face ID 2FA** and **Google Sheets read/write** are the next step,
  which is when we wire your personal Supabase.

## Structure
```
app/
  server.js                 Express: static + /api/* (+ SPA fallback)
  public/                   the PWA (index.html, styles.css, app.js, sw.js, manifest, icons)
  scripts/generate-icons.js SVG → PNG icons
  render.yaml               Render blueprint
```
