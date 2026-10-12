# Spec: auth-session-cleanup

Issue #178. Follow-up of `server-sessions` (#177, [`SPEC-server-sessions.md`](SPEC-server-sessions.md)). **Status: approved 2026-10-11** (decisions below; three doubt-review cycles).

## Objective

`auth_sessions` never deletes a row: every login adds one, and expired or revoked sessions stay forever with their IP and user agent. Validation does not depend on deleting them (`authenticate` already filters expiry and revocation), so this is data minimization and housekeeping, not access control.

After this module, sessions that **ended** more than a fixed retention ago are deleted automatically, in every environment, with no new infrastructure. An active session is never touched.

## Decisions it builds on

- **Retention is a code constant** (`apps/api/src/lib/retentionPolicy.ts`), like `authSessionPolicy.ts`: security policy changes in a reviewed PR, not per deployment ([audit map](audit-map.md), decision 8).
- **At least 180 days.** The audit spec requires keeping `auth_sessions` at least as long as `login_events` (180 days), so a recent audit row's `auth_session_id` still resolves to a device and IP ([`SPEC-audit-hardening.md`](SPEC-audit-hardening.md) §3). After that, the id alone still groups one login's actions.
- **By age only**, never "keep the newest N".
- **Scheduled inside the app**, because Render free has no cron. Map decision 8 says "throttled like `refreshAlerts`", meaning on a request; this module uses timers instead, off every request, and updates the decision's wording in `audit-map.md`. A Render cron job is a paid service per environment, and `pg_cron` on Neon only runs while the compute is awake, which on the free plan it usually is not.

## Design

### What "ended" means

A session can no longer be valid after the earliest of three moments:
- `revoked_at` (logout, password change, disconnection, deactivation);
- `expires_at` (the absolute timeout);
- `last_used_at` + the longest idle timeout of any profile (7 days today, trusted). `authenticate` decides idleness against the stored `last_used_at`, so no session idle that long can be valid, whatever its profile.

Nothing in the code clears `revoked_at`, pushes `expires_at` later or turns a session back into a trusted one, so once a session can no longer be valid it never becomes valid again.

That earliest moment is when the session **ended**. Taking the earliest matters: many writes revoke every session of a user with `revoked_at IS NULL`, including sessions that expired long ago. Counting from the revocation would then keep a session that expired 170 days ago for another 180 days. The idle bound is the maximum `idleMs` over the profiles in `authSessionPolicy.ts`, so a policy change moves it too.

"Ended more than the retention ago" is then three independent conditions. The cutoffs come from one exported pure function, `authSessionCleanupCutoffs(now)` in `lib/retentionPolicy.ts`, which the job and the database test both use, so the test exercises the real arithmetic:

```ts
const cutoff = new Date(now - AUTH_SESSION_RETENTION);
const idleCutoff = new Date(cutoff - LONGEST_IDLE);
// ended before the cutoff  ⇔  any of the three moments is before it
where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }, { lastUsedAt: { lt: idleCutoff } }] }
```

The delete goes through the Prisma client with typed `DateTime` fields, like every other query here: no raw SQL, no interval arithmetic and no time-zone handling of its own. `deleteMany` has no limit, so each batch is a `findMany({ select: { id }, take })` followed by `deleteMany({ where: { id: { in } } })`.

Each condition implies the session cannot be valid, so an active session never matches, and a test pins that. Each condition can use an index if the table ever needs one. Today it holds hundreds of rows, so none is added.

### When it runs

Render free puts the API to sleep after 15 idle minutes, so nothing inside the process can run at a fixed hour of the night: at 3 AM there is usually no process. What there is, several times a day, is a cold start. So:

- **1 minute after the server starts listening** (`RETENTION_RUN_DELAY`). That is past the burst of first requests after a cold start (the users who woke the API up), and well before Neon suspends its compute, about 5 idle minutes after the last query. So the run rarely has to wake the database again.
- **Then every 24 hours while the process lives** (`RETENTION_RUN_INTERVAL`), for the rare process that is not restarted for days. On Render free most processes die within the day, so the run after each cold start does nearly all the work.
- **Both timers are `unref()`ed**, so they never keep the process alive or delay a shutdown.
- **Never on the request path:** login and `authenticate` are unchanged.
- **Size:** batches of 1000 rows, repeated while a batch comes back full, up to 10 batches (10 000 rows) per run. A backlog drains over successive runs, never in one long lock.
- **Failure** (the database asleep or unreachable) is logged and retried at the next run. It never crashes the process.
- **Where it lives:**
  - `authRepository.deleteEndedAuthSessions({ cutoff, idleCutoff, batch })` deletes one batch and returns the count. It takes no `ctx`, like the rest of `authRepository`.
  - **A general retention runner**, `lib/retention.ts`, owns the timers, the batch loop, the cap and the logging. It runs a list of purge jobs, each with its retention in `lib/retentionPolicy.ts`. This module registers the first job. The `login_events` purge of `security-events`, and any later one, adds a job instead of new timers or a second wake-up of the database (map decision 8).
  - `index.ts` starts the runner after `listen`, next to the audit startup check, so tests never run it.

A run at a fixed night hour would need something outside Render to wake the API (a paid Render cron job, or a scheduled GitHub Actions workflow calling an authenticated maintenance endpoint). At this scale a run is a few milliseconds of Neon time, so that is deferred until load makes it worth it.

### Out of scope

- **`password_reset_tokens`.** Its rows keep evidence (`created_ip`, `used_ip`, who generated the link) that `clinic-audit` and `account-audit` will read. They are cleaned once that evidence reaches an audit row, in those modules.
- **`login_events`** has its own purge in `security-events`.
- **The operator's sessions:** the operator still uses a JWT, until `operator-sessions`.

## Commands

`npm test` (API), `npm run check`. No migration: the columns exist. An index is added only if the plan shows the delete scanning the whole table at realistic sizes. It does not today: the table is small.

## Testing Strategy

Tests run in parallel against one shared database, and two CI runs can share `ci` at once. So every test of the real delete looks **only at its own rows**, present or absent, with a batch large enough to never be the limit. The batch loop and the cap are tested apart, on a fake job.

- **`tests/authSessionCleanup.test.ts`** (real database, own user, backdated rows, one call to the repository with a large batch):
  - **Deleted:**
    - revoked 181 days ago;
    - expired 181 days ago;
    - expired 200 days ago and revoked yesterday (the earliest moment counts, not the revocation);
    - last used 188 days ago (181 + 7), with an expiry still ahead.
  - **Kept:**
    - an active session;
    - revoked yesterday;
    - expired 179 days ago;
    - a trusted session idle for 6 days;
    - a session last used 186 days ago (ended by idleness 179 days ago).
  - **Real cutoffs:** every case uses `authSessionCleanupCutoffs(now)`, never cutoffs the test works out by hand.
  - **Audit:** an audit row is inserted while its session exists. The session is then backdated and deleted: the delete succeeds, and the audit row is still readable and keeps its `auth_session_id`.
- **`tests/retention.test.ts`** (no database, fake jobs, fake timers):
  - the first run happens after the delay, never before;
  - later runs every 24 hours;
  - the batch loop repeats while a batch comes back full, and stops at the cap;
  - a job that throws is logged, the other jobs still run, and the next run still happens;
  - `unref()` is called on both timer handles (a spy on the returned handle, since fake timers stub it).

**Coverage per environment:**
- `production` and `staging` are cleaned by the runner, after each cold start.
- `development` is cleaned whenever the API runs locally.
- `ci` never runs `index.ts` and needs nothing. Each test's users and their sessions go with its own cleanup (`ON DELETE CASCADE`), interrupted runs leave only recent sessions, and release PRs rebuild `ci` from scratch.

**The seed's demo session** is dated relative to the seed run: created two days before and expired one day before, refreshed by its upsert. Today it is dated 2026-03-06, already past the retention. A local API started before `db:seed` could then delete it between the moment the seed creates it and the moment the seed inserts the demo audit rows that name it, and the session check would make the seed fail. The demo audit rows keep their backdated times, earlier than the session: nothing compares the two.

## Boundaries

- **Always:** delete by age only; leave valid sessions alone; keep the retention in code.
- **Ask first:** a retention below 180 days; cleaning other tables here.
- **Never:** delete on the request path; delete by count.

## Success Criteria

- [ ] Sessions that ended more than 180 days ago disappear without anyone running anything, in every environment.
- [ ] No active session is ever deleted (test).
- [ ] The retention is documented next to the model and in `CLAUDE.md` (the sessions paragraph).

## Decisions (2026-10-11)

1. **Trigger:** 1 minute after each start, then every 24 hours while the process lives; nothing on login. Nath proposed deferring the run after spin-up; the delay is 1 minute, not 5, so the database is still awake (doubt review, cycle 1). There is no fixed night hour, which Render free cannot honour.
2. **Retention: 180 days** after a session ended, the floor that the audit spec sets (Nath).

## Open Questions

None.
