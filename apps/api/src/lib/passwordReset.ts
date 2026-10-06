import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

// Password reset policy (docs/specs/SPEC-password-reset.md). A code constant
// on purpose, like the session lifetimes: security policy changes in a
// reviewed PR, not per deployment.
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

// What replaces the user's password hash while a reset is pending: a bcrypt
// hash of a random secret nobody knows. Not an empty or sentinel value — the
// login keeps running bcrypt against a real hash of the usual cost, so it
// takes the same time and gives the same 401 as any wrong password, and
// whether an account is mid-reset cannot be told from the login (issue #71).
export function disabledPasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('base64url'), 10);
}
