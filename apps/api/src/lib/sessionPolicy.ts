// How long a session lives (docs/specs/SPEC-my-sessions.md). Security policy,
// not deployment config: changing a value is a reviewed code change.
//
// Every session has two timeouts and dies at whichever comes first:
//   - idle: since the last use. Kills a session left open and abandoned
//     (the reception computer, a lost phone).
//   - absolute: since login. Caps a stolen session, which an attacker keeps
//     alive by using it — the idle timeout alone would never fire.
// OWASP and NIST SP 800-63B both require the absolute one; Ficha is
// password-only (NIST AAL1), which allows up to 30 days absolute.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface SessionProfile {
  idleMs: number;
  absoluteMs: number;
}

// Default: short, so a session on a shared computer dies on its own within
// the hour. 12 h absolute covers a working day.
export const NORMAL_SESSION: SessionProfile = { idleMs: 1 * HOUR, absoluteMs: 12 * HOUR };

// "Mantener la sesión iniciada en este dispositivo", chosen at login for the
// user's own devices.
export const TRUSTED_SESSION: SessionProfile = { idleMs: 7 * DAY, absoluteMs: 30 * DAY };

export function sessionProfile(trusted: boolean): SessionProfile {
  return trusted ? TRUSTED_SESSION : NORMAL_SESSION;
}

// At most this many trusted sessions per user; a new one beyond the cap
// demotes the oldest to normal.
export const TRUSTED_SESSIONS_PER_USER = 3;

// last_used_at is written at most this often per session: without it every
// request would be a write. "Last activity" is accurate to this much, and
// idle expiry can fire this much late.
export const LAST_USED_THROTTLE_MS = 5 * MINUTE;
