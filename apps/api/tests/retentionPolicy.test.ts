import { describe, expect, it } from 'vitest';
import { NORMAL_SESSION, TRUSTED_SESSION } from '../src/lib/authSessionPolicy';
import {
  AUTH_SESSION_RETENTION,
  LONGEST_IDLE,
  authSessionCleanupCutoffs,
} from '../src/lib/retentionPolicy';

const DAY = 24 * 60 * 60 * 1000;

// When an ended login session may be deleted (#178,
// docs/specs/SPEC-auth-session-cleanup.md). The cutoffs decide which sessions
// go, so the job and the database test both use this one function.
describe('auth session cleanup cutoffs', () => {
  it('keeps sessions 180 days after they ended, the floor set by the audit spec', () => {
    expect(AUTH_SESSION_RETENTION).toBe(180 * DAY);
  });

  it('bounds idleness with the longest idle timeout of any profile', () => {
    expect(LONGEST_IDLE).toBe(Math.max(NORMAL_SESSION.idleMs, TRUSTED_SESSION.idleMs));
  });

  it('derives both cutoffs from now', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const { cutoff, idleCutoff } = authSessionCleanupCutoffs(now);

    expect(cutoff.toISOString()).toBe('2026-04-14T12:00:00.000Z');
    expect(idleCutoff.getTime()).toBe(cutoff.getTime() - LONGEST_IDLE);
  });
});
