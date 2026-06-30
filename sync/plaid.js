// Plaid client (production) from env vars (set in Render dashboard).
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cfg = require('../lib/config');

function client() {
  if (!cfg.PLAID_CLIENT_ID || !cfg.PLAID_SECRET) throw new Error('Plaid env not set (PLAID_CLIENT_ID / PLAID_SECRET)');
  const configuration = new Configuration({
    basePath: PlaidEnvironments.production,
    baseOptions: { headers: { 'PLAID-CLIENT-ID': cfg.PLAID_CLIENT_ID, 'PLAID-SECRET': cfg.PLAID_SECRET } },
  });
  return new PlaidApi(configuration);
}

module.exports = { client };
