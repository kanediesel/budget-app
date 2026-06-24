// Signed httpOnly cookie sessions (JWT). Used for both the login session and the
// short-lived WebAuthn challenge.
const jwt = require('jsonwebtoken');
const cfg = require('./config');

const SESSION_COOKIE = 'bsess';
const CHALLENGE_COOKIE = 'bchal';

function cookieOpts(maxAgeMs) {
  return { httpOnly: true, secure: cfg.isProd, sameSite: 'lax', path: '/', maxAge: maxAgeMs };
}

function setSession(res, payload) {
  const token = jwt.sign(payload, cfg.SESSION_SECRET, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, cookieOpts(30 * 24 * 3600 * 1000));
}
function clearSession(res) { res.clearCookie(SESSION_COOKIE, { path: '/' }); }
function getSession(req) {
  const t = req.cookies && req.cookies[SESSION_COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, cfg.SESSION_SECRET); } catch { return null; }
}

// challenge: signed, 5-minute cookie carrying the WebAuthn challenge (+ optional context)
function setChallenge(res, data) {
  const token = jwt.sign(data, cfg.SESSION_SECRET, { expiresIn: '5m' });
  res.cookie(CHALLENGE_COOKIE, token, cookieOpts(5 * 60 * 1000));
}
function getChallenge(req) {
  const t = req.cookies && req.cookies[CHALLENGE_COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, cfg.SESSION_SECRET); } catch { return null; }
}
function clearChallenge(res) { res.clearCookie(CHALLENGE_COOKIE, { path: '/' }); }

// express middleware: require a valid session
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  req.user = s; next();
}

module.exports = { setSession, clearSession, getSession, setChallenge, getChallenge, clearChallenge, requireAuth };
