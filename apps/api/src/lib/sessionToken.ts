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

