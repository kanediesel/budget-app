// Write helper: append an expense row into a month tab below the second grey line,
// coloring A:E by account (Cash = black) and keeping F:G black. Mirrors the pipeline writer.
const { client } = require('./sheets');
const cfg = require('./config');

const isGrey = (bg) => bg && (bg.red || 0) > 0.3 && (bg.red || 0) < 0.55 && Math.abs((bg.red || 0) - (bg.green || 0)) < 0.1 && Math.abs((bg.green || 0) - (bg.blue || 0)) < 0.1;
const hexToRgb = (h) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 });

async function findLayout(tab) {
  const s = await client();
  const meta = await s.spreadsheets.get({ spreadsheetId: cfg.SHEET_ID, fields: 'sheets.properties(title,sheetId)' });
  const sh = meta.data.sheets.find((x) => x.properties.title === tab);
  if (!sh) return null;
  const res = await s.spreadsheets.get({
    spreadsheetId: cfg.SHEET_ID, ranges: [`${tab}!A1:G300`], includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,userEnteredFormat.backgroundColor)',
  });
  const rows = res.data.sheets[0].data[0].rowData || [];
  const greys = [];
  rows.forEach((r, i) => { const c = (r.values || [])[0]; if (c && isGrey(c.userEnteredFormat && c.userEnteredFormat.backgroundColor)) greys.push(i + 1); });
  const grey2 = greys[1] || greys[0] || 13;
  let firstExpenseRow = grey2 + 1;
  for (let r = grey2 + 1; r <= rows.length + 1; r++) {
    const cells = (rows[r - 1] && rows[r - 1].values) || [];
    const a = (cells[0] && cells[0].formattedValue) || '', b = (cells[1] && cells[1].formattedValue) || '';
    if (a || b) firstExpenseRow = r + 1; else { firstExpenseRow = r; break; }
  }
  return { sheetId: sh.properties.sheetId, grey2, firstExpenseRow };
}

// values7 = [date, merchant, notes/account, expenses, revenue, category, subcategory]
async function appendExpenseRow(tab, values7, colorHex) {
  const s = await client();
  const layout = await findLayout(tab);
  if (!layout) throw new Error('tab not found: ' + tab);
  const row = layout.firstExpenseRow;
  await s.spreadsheets.values.update({
    spreadsheetId: cfg.SHEET_ID, range: `${tab}!A${row}:G${row}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [values7] },
  });
  await s.spreadsheets.batchUpdate({
    spreadsheetId: cfg.SHEET_ID, requestBody: { requests: [
      { repeatCell: { range: { sheetId: layout.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgb(colorHex) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } },
      { repeatCell: { range: { sheetId: layout.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 5, endColumnIndex: 7 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } },
    ] },
  });
  return row;
}

const ACCOUNT_COLORS = {
  'Cash': '#000000', 'B-Capital One': '#45818e', 'A-Capital One': '#ff0000', 'BILT': '#990000',
  'Citi': '#ff00ff', 'Marriott': '#b45f06', 'Apple': '#1155cc', 'USAA': '#38761d',
};
const colorForAccount = (a) => ACCOUNT_COLORS[a] || '#000000';
const normDate = (s) => { const m = String(s || '').match(/(\d+)\/(\d+)\/(\d+)/); return m ? `${+m[3]}-${+m[1]}-${+m[2]}` : ''; };

// find an already-entered charge (e.g. the synced Plaid row) to split in place
async function findCharge(tab, merchant, total, mdy) {
  const s = await client();
  const rows = (await s.spreadsheets.values.get({ spreadsheetId: cfg.SHEET_ID, range: `${tab}!A1:G400` })).data.values || [];
  const wantM = String(merchant || '').toLowerCase(), wantDate = normDate(mdy);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = normDate(r[0] || ''); const b = (r[1] || '').toLowerCase();
    const amt = parseFloat(String(r[3] || '').replace(/[^0-9.\-]/g, ''));
    if (d === wantDate && Math.abs(amt - total) < 0.01 && (b.includes(wantM) || wantM.includes(b))) return i + 1;
  }
  return null;
}

// Write a receipt split. Replaces the existing charge row in place if present (overwrite + insert),
// else appends below the grey line. Notes column carries the ORIGINAL TOTAL ("$65.16") on every row
// (your convention + the dedup marker the sync looks for). lines amounts must already sum to total.
async function writeSplit(tab, lines, meta) {
  const s = await client();
  const layout = await findLayout(tab);
  if (!layout) throw new Error('tab not found: ' + tab);
  const total = lines.reduce((a, l) => a + Number(l.amount), 0);
  const totalStr = '$' + total.toFixed(2);
  const color = colorForAccount(meta.account);
  const existing = await findCharge(tab, meta.merchant, total, meta.date);
  const values = lines.map((l) => [meta.date, meta.merchant, totalStr, Number(l.amount), '', l.category, l.subcategory || '']);

  let startRow;
  if (existing) {
    startRow = existing;
    if (lines.length > 1) {
      await s.spreadsheets.batchUpdate({ spreadsheetId: cfg.SHEET_ID, requestBody: { requests: [
        { insertDimension: { range: { sheetId: layout.sheetId, dimension: 'ROWS', startIndex: existing, endIndex: existing + lines.length - 1 }, inheritFromBefore: true } },
      ] } });
    }
  } else {
    startRow = layout.firstExpenseRow;
  }
  const end = startRow + lines.length - 1;
  await s.spreadsheets.values.update({ spreadsheetId: cfg.SHEET_ID, range: `${tab}!A${startRow}:G${end}`, valueInputOption: 'USER_ENTERED', requestBody: { values } });
  await s.spreadsheets.batchUpdate({ spreadsheetId: cfg.SHEET_ID, requestBody: { requests: [
    { repeatCell: { range: { sheetId: layout.sheetId, startRowIndex: startRow - 1, endRowIndex: end, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgb(color) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } },
    { repeatCell: { range: { sheetId: layout.sheetId, startRowIndex: startRow - 1, endRowIndex: end, startColumnIndex: 5, endColumnIndex: 7 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } },
  ] } });
  return { startRow, count: lines.length, replacedInPlace: !!existing };
}

module.exports = { findLayout, appendExpenseRow, hexToRgb, ACCOUNT_COLORS, colorForAccount, findCharge, writeSplit };
