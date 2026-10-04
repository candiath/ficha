import { createHash, randomBytes } from 'node:crypto';

// Opaque session tokens (docs/specs/SPEC-server-sessions.md).
//
// The token is 256 random bits and carries no data: everything about the
// session lives in auth_sessions, looked up by the token's hash. The raw token
// exists only in the login response and in the client; the database stores
// sha256(token), so a leaked table or backup yields no usable session.
//
// A plain hash is enough (no bcrypt/salt): those defend low-entropy secrets
// like passwords against guessing, and 256 random bits cannot be guessed.

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_DAYS = 7;

// Absolute lifetime of a session, from SESSION_TTL_DAYS (whole days, default
// 7). Long because a session can be revoked one by one; idle expiry comes
// with the session list (my-sessions).
//
// Strict on purpose, and called at startup by app.ts: a value like "7d" would
// otherwise become NaN and make every login a 500, and "0" would hand out
// sessions that are born expired — login "works" and logs the user out at
// once, with no error anywhere. Failing here fails the deploy instead, and
// Render keeps serving the previous one.
export function getSessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_SESSION_TTL_DAYS * DAY_MS;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      `SESSION_TTL_DAYS must be a positive whole number of days, got "${raw}"`,
    );
  }
  return Number(raw) * DAY_MS;
}
