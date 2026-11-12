'use strict';

// Phone check for mobile-app maintenance requests. On a call, caller ID identifies the
// resident; in the app the resident proves the number by entering a code texted to it.
//
// Stateless: the server signs a challenge { phone, nonce, expiry, keyed code hash } with
// PMA_APP_VERIFY_SECRET and the app sends it back with the code. The code hash is keyed by
// the secret, so a challenge cannot be brute-forced offline. The nonce becomes the request's
// session id, so one verification files at most one case.

const crypto = require('node:crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest();

// US and Canada mobile numbers only (NANP): keeps texts on domestic routes and away from
// international premium-rate numbers. Returns +1XXXXXXXXXX or null.
function normalizeNanpPhone(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 30 || !/^[+\d().\-\s]+$/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return '+1' + d;
}

function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function secretOk(secret) {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

function createChallenge({ phone, code, secret, now = Date.now() }) {
  if (!secretOk(secret)) throw new Error('VERIFY_SECRET_MISSING');
  const n = crypto.randomBytes(12).toString('base64url');
  const e = now + CODE_TTL_MS;
  const h = b64(hmac(secret, `code:${n}:${phone}:${code}`));
  const payload = b64(JSON.stringify({ v: 1, p: phone, n, e, h }));
  const sig = b64(hmac(secret, `challenge:${payload}`));
  return { challenge: `${payload}.${sig}`, nonce: n, expiresAt: e };
}

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Returns { ok: true, phone, nonce } or { ok: false, state } where state is
// INVALID (tampered or malformed), EXPIRED, or WRONG_CODE.
function checkChallenge({ challenge, code, secret, now = Date.now() }) {
  if (!secretOk(secret)) return { ok: false, state: 'INVALID' };
  const parts = String(challenge || '').split('.');
  if (parts.length !== 2 || parts[0].length > 600) return { ok: false, state: 'INVALID' };
  const [payload, sig] = parts;
  if (!safeEqual(sig, b64(hmac(secret, `challenge:${payload}`)))) return { ok: false, state: 'INVALID' };
  let body;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { ok: false, state: 'INVALID' }; }
  if (!body || body.v !== 1 || typeof body.p !== 'string' || typeof body.n !== 'string' || typeof body.e !== 'number') {
    return { ok: false, state: 'INVALID' };
  }
  if (now > body.e) return { ok: false, state: 'EXPIRED' };
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return { ok: false, state: 'WRONG_CODE', nonce: body.n };
  if (!safeEqual(body.h, b64(hmac(secret, `code:${body.n}:${body.p}:${c}`)))) {
    return { ok: false, state: 'WRONG_CODE', nonce: body.n };
  }
  return { ok: true, phone: body.p, nonce: body.n };
}

module.exports = { normalizeNanpPhone, newCode, createChallenge, checkChallenge, CODE_TTL_MS };
