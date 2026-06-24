// Supabase admin client (service-role / secret key — SERVER ONLY, never sent to the browser).
const { createClient } = require('@supabase/supabase-js');
const cfg = require('./config');

let _client = null;
function db() {
  if (!_client) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_KEY) throw new Error('Supabase env not set (SUPABASE_URL / SUPABASE_SERVICE_KEY)');
    _client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  }
  return _client;
}
module.exports = { db };
