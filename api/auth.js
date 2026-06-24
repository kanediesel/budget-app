// Passkey (WebAuthn) auth. Face ID on iPhone = a platform passkey: device + biometric in one tap.
// Registration is gated to ALLOWED_EMAILS (your household). Login is usernameless (discoverable).
const express = require('express');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const cfg = require('../lib/config');
const { db } = require('../lib/supabase');
const S = require('../lib/session');

const router = express.Router();
const b64 = (u8) => Buffer.from(u8).toString('base64url');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

async function findOrCreateUser(email) {
  const { data: existing } = await db().from('app_users').select('*').eq('email', email).maybeSingle();
  if (existing) return existing;
  const display = email.split('@')[0];
  const { data, error } = await db().from('app_users').insert({ email, display_name: display }).select().single();
  if (error) throw error;
  return data;
}

// ---- REGISTER (enroll a passkey on this device) ----
router.post('/register/options', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!cfg.ALLOWED_EMAILS.includes(email)) return res.status(403).json({ error: 'This email is not allowed to register.' });
    const user = await findOrCreateUser(email);
    const { data: creds } = await db().from('webauthn_credentials').select('id,transports').eq('user_id', user.id);
    const options = await generateRegistrationOptions({
      rpName: cfg.RP_NAME, rpID: cfg.RP_ID,
      userID: new TextEncoder().encode(user.id), userName: email, userDisplayName: user.display_name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: (creds || []).map((c) => ({ id: c.id, transports: c.transports || undefined })),
    });
    S.setChallenge(res, { type: 'reg', challenge: options.challenge, userId: user.id, email });
    res.json(options);
  } catch (e) { console.error('register/options', e); res.status(500).json({ error: e.message }); }
});

router.post('/register/verify', async (req, res) => {
  try {
    const chal = S.getChallenge(req);
    if (!chal || chal.type !== 'reg') return res.status(400).json({ error: 'no challenge' });
    const verification = await verifyRegistrationResponse({
      response: req.body, expectedChallenge: chal.challenge,
      expectedOrigin: cfg.RP_ORIGIN, expectedRPID: cfg.RP_ID, requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'not verified' });
    const c = verification.registrationInfo.credential;
    const { error } = await db().from('webauthn_credentials').insert({
      id: c.id, user_id: chal.userId, public_key: b64(c.publicKey), counter: c.counter || 0,
      transports: c.transports || null,
    });
    if (error) throw error;
    S.clearChallenge(res);
    S.setSession(res, { userId: chal.userId, email: chal.email });
    res.json({ ok: true, user: { email: chal.email } });
  } catch (e) { console.error('register/verify', e); res.status(500).json({ error: e.message }); }
});

// ---- LOGIN (Face ID) ----
router.post('/login/options', async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({ rpID: cfg.RP_ID, userVerification: 'required' });
    S.setChallenge(res, { type: 'auth', challenge: options.challenge });
    res.json(options);
  } catch (e) { console.error('login/options', e); res.status(500).json({ error: e.message }); }
});

router.post('/login/verify', async (req, res) => {
  try {
    const chal = S.getChallenge(req);
    if (!chal || chal.type !== 'auth') return res.status(400).json({ error: 'no challenge' });
    const { data: cred } = await db().from('webauthn_credentials').select('*').eq('id', req.body.id).maybeSingle();
    if (!cred) return res.status(401).json({ error: 'unknown passkey' });
    const verification = await verifyAuthenticationResponse({
      response: req.body, expectedChallenge: chal.challenge,
      expectedOrigin: cfg.RP_ORIGIN, expectedRPID: cfg.RP_ID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: fromB64(cred.public_key), counter: Number(cred.counter), transports: cred.transports || undefined },
    });
    if (!verification.verified) return res.status(401).json({ error: 'not verified' });
    await db().from('webauthn_credentials').update({ counter: verification.authenticationInfo.newCounter }).eq('id', cred.id);
    const { data: user } = await db().from('app_users').select('*').eq('id', cred.user_id).single();
    S.clearChallenge(res);
    S.setSession(res, { userId: user.id, email: user.email });
    res.json({ ok: true, user: { email: user.email, name: user.display_name } });
  } catch (e) { console.error('login/verify', e); res.status(500).json({ error: e.message }); }
});

router.get('/me', (req, res) => {
  const s = S.getSession(req);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: { email: s.email } });
});
router.post('/logout', (req, res) => { S.clearSession(res); res.json({ ok: true }); });

module.exports = router;
