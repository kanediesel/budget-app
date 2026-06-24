// Central env config with local-dev defaults.
const e = process.env;
module.exports = {
  PORT: e.PORT || 3000,
  // WebAuthn relying party (must match the domain the app is served from)
  RP_ID: e.RP_ID || 'localhost',
  RP_ORIGIN: e.RP_ORIGIN || 'http://localhost:3000',
  RP_NAME: e.RP_NAME || 'Budget',
  // only these emails may register a passkey (your household)
  ALLOWED_EMAILS: (e.ALLOWED_EMAILS || 'brian.maucere@gmail.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  SESSION_SECRET: e.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  SUPABASE_URL: e.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: e.SUPABASE_SERVICE_KEY || '', // sb_secret_... (server only)
  GOOGLE_SERVICE_ACCOUNT_JSON: e.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  SHEET_ID: e.SHEET_ID || '1EQZiV2QqMz_9IfVQKUFM0LR24BJlXb9mGLcqAQmPflo',
  isProd: e.NODE_ENV === 'production' || !!e.RENDER,
};
