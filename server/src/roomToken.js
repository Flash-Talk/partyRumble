'use strict';

const crypto = require('crypto');

/**
 * Room-code ownership proof. When a room is created the server hands the host a
 * short HMAC of the room code (`roomToken`). To recreate a room under a specific
 * code after the server lost it (restart/redeploy), the host must present a valid
 * roomToken — which it can only have if the server previously issued that code.
 * This stops a client from squatting or impersonating arbitrary room codes.
 *
 * Set ROOM_SECRET in the environment for a stable signature across redeploys (so
 * same-code recovery survives a restart). Without it a per-boot secret is used:
 * recovery then only works within a single server lifetime, but squatting is
 * still prevented.
 */
const SECRET = process.env.ROOM_SECRET || crypto.randomBytes(32).toString('hex');

function signCode(code) {
  return crypto.createHmac('sha256', SECRET).update(String(code)).digest('base64url').slice(0, 16);
}

function verifyCode(code, token) {
  if (!code || !token) return false;
  const expected = Buffer.from(signCode(code));
  const given = Buffer.from(String(token));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { signCode, verifyCode };
