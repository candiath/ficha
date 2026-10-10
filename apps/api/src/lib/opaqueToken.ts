import { createHash, randomBytes } from 'node:crypto';

// Opaque bearer secrets: login sessions (docs/specs/SPEC-server-sessions.md)
// and password reset links (docs/specs/SPEC-password-reset.md).
//
// The token is 256 random bits and carries no data: everything about it lives
// in its table, looked up by the token's hash. The raw token exists only in
// the response that hands it out and in the client; the database stores
// sha256(token), so a leaked table or backup yields nothing usable.
//
// A plain hash is enough (no bcrypt/salt): those defend low-entropy secrets
// like passwords against guessing, and 256 random bits cannot be guessed.

export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
