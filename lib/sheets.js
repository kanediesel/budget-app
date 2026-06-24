// Google Sheets client (service account). The sheet is the source of truth.
// Credentials come from either GOOGLE_SERVICE_ACCOUNT_JSON (env string) or
// GOOGLE_SERVICE_ACCOUNT_FILE (path, e.g. a Render Secret File).
const fs = require('fs');
const { google } = require('googleapis');
const cfg = require('./config');

function loadCreds() {
  if (cfg.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(cfg.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (cfg.GOOGLE_SERVICE_ACCOUNT_FILE) return JSON.parse(fs.readFileSync(cfg.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
  throw new Error('Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE');
}

let _sheets = null;
async function client() {
  if (_sheets) return _sheets;
  const creds = loadCreds();
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  _sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return _sheets;
}

async function meta() {
  const s = await client();
  const res = await s.spreadsheets.get({ spreadsheetId: cfg.SHEET_ID, fields: 'properties.title,sheets.properties.title' });
  return { title: res.data.properties.title, tabs: res.data.sheets.map((x) => x.properties.title) };
}

async function readRange(range) {
  const s = await client();
  const res = await s.spreadsheets.values.get({ spreadsheetId: cfg.SHEET_ID, range });
  return res.data.values || [];
}

module.exports = { client, meta, readRange };
