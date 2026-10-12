import { NORMAL_SESSION, TRUSTED_SESSION } from './authSessionPolicy';

// How long data is kept once it has served its purpose, and how the purge
// runs (docs/specs/audit-map.md, decision 8). Policy, not deployment config:
// changing a value is a reviewed code change. The jobs run in lib/retention.ts.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ─── auth_sessions (#178, docs/specs/SPEC-auth-session-cleanup.md) ──────────

// An ended login session keeps its device, IP and user agent this long. Not
// less than login_events' 180 days: a recent audit row's auth_session_id must
// still resolve to a device (SPEC-audit-hardening.md §3).
export const AUTH_SESSION_RETENTION = 180 * DAY;

// No session idle this long can be valid, whatever its profile: authenticate
// decides idleness against the stored last_used_at.
export const LONGEST_IDLE = Math.max(NORMAL_SESSION.idleMs, TRUSTED_SESSION.idleMs);

// A session ended at the earliest of its revocation, its expiry, and
// last_used_at + LONGEST_IDLE. It may be deleted when that moment is before
// `cutoff`, i.e. when any of the three is: revokedAt < cutoff,
// expiresAt < cutoff, or lastUsedAt < idleCutoff.
export function authSessionCleanupCutoffs(now: Date): { cutoff: Date; idleCutoff: Date } {
  const cutoff = new Date(now.getTime() - AUTH_SESSION_RETENTION);
  return { cutoff, idleCutoff: new Date(cutoff.getTime() - LONGEST_IDLE) };
}

// ─── The runner (lib/retention.ts) ───────────────────────────────────────────

// After a cold start: past the burst of first requests (the users who woke
// the API up), and before Neon suspends its compute, ~5 idle minutes after
// the last query, so a run rarely has to wake the database again.
export const RETENTION_RUN_DELAY = 1 * MINUTE;

// For the rare process that lives for days: Render free restarts the API
// several times a day, so the run after each start does nearly all the work.
export const RETENTION_RUN_INTERVAL = 24 * HOUR;

// Rows per delete, and batches per job and run: a backlog drains over several
// runs instead of one long lock.
export const RETENTION_BATCH = 1000;
export const RETENTION_MAX_BATCHES = 10;
