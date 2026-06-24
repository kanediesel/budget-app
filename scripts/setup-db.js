// One-off: create the app's Supabase tables. Reads connection from PG* env vars
// (no secrets in this file). Usage:
//   PGHOST=... PGUSER=postgres PGPASSWORD='...' PGDATABASE=postgres node scripts/setup-db.js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-schema.sql'), 'utf8');
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name in ('app_users','webauthn_credentials') order by table_name"
  );
  console.log('Tables present:', rows.map((r) => r.table_name).join(', ') || '(none)');
  await client.end();
})().catch((e) => { console.error('DB SETUP ERROR:', e.message); process.exit(1); });
