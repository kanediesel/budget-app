// Google Sheets client (service account from env). The sheet is the source of truth.
const { google } = require('googleapis');
const cfg = require('./config');

let _sheets = null;
async function client() {
  if (_sheets) return _sheets;
  if (!cfg.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const creds = JSON.parse(cfg.GOOGLE_SERVICE_ACCOUNT_JSON);
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
