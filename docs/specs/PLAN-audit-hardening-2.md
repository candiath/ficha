# Implementation Plan: audit-hardening, second PR (enforcement)

Spec: [`SPEC-audit-hardening.md`](SPEC-audit-hardening.md) (approved 2026-10-09), *Rollout* steps 2 and 3. The first PR ([`PLAN-audit-hardening.md`](PLAN-audit-hardening.md), #210) is in production since release #212.

## Overview

The database starts enforcing what PR 1 prepared:
- audit rows become append-only, stamped by the database, with real sessions and composite `RESTRICT` foreign keys;
- two SQL checks run in CI, in the Render build and at API startup;
- two scans keep the switch out of the app and destructive DDL out of future migrations.

Everything is developed against a throwaway Neon branch, rehearsed on a copy of `production`, and only then opened as a PR against `dev`.

## Architecture Decisions

- **One migration, rebuilt until final.** It grows task by task (triggers, then session check, then foreign keys). Each time it changes, the throwaway branch is reset from its parent and the migration re-applied: `migrate deploy` never re-applies an edited migration, and the shared branches never see a draft.
- **The throwaway branch's URL never enters the chat.** You put it in `apps/api/.env.audit-pr2` (ignored by `.env.*`), as `DATABASE_URL` and `DIRECT_DATABASE_URL`. I load it into the environment of each command (`set -a; . apps/api/.env.audit-pr2`); dotenv does not override variables already set, so `apps/api/.env` stays untouched and nothing prints the URL.
- **The `production` rehearsal goes through the Neon MCP**: a branch copied from `production`, the migration through `run_sql_transaction`, and the §2 queries. No URL needed (memory: `get_connection_string` is blocked).
- **Expected hashes are computed once, on the throwaway branch**, and written into `audit-guards.sql`. All branches run the same Postgres version (one Neon project); a CI failure on `ci` would reveal any difference before staging.
- **The startup check reads the two `.sql` files and runs them through a repository method** (`auditGuardRepository`), so the lint rule on raw database access holds. It only logs.

## Task List

### Phase 0: Setup (one-time, before any code)

- [x] **Task 0: Flag on `development` and `ci`; the throwaway branch**
  - *Acceptance:*
    - `CREATE SCHEMA IF NOT EXISTS ficha_ops; CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed ();` runs on `development` and `ci` (MCP);
    - `to_regclass` returns it on both, and returns null on `staging` and `production`;
    - Neon branch `audit-hardening-pr2` is created from `development`, so it inherits the flag;
    - you create `apps/api/.env.audit-pr2`.
  - *Verify:* the full API suite passes on the throwaway branch before any change (baseline).
  - *Files:* none in the repo; `docs/infra.md` documents it in Task 9. **XS**

### Phase 1: Triggers (the core guarantee, highest risk first)

- [x] **Task 1: Append-only and database-stamped time**
  - *Acceptance:*
    - The migration creates `audit_maintenance_on`, `audit_rows_are_append_only` and `audit_rows_stamp_created_at` (spec §1, verbatim), plus their six triggers on both tables.
    - `created_at` becomes `timestamp(6)` (`@db.Timestamp(6)`).
    - `.sql` files are checked out LF.
  - *Verify:*
    - `migrate diff --exit-code` reports 0 on the throwaway branch.
    - New tests in `tests/auditHardening.test.ts` on the test's own rows: `update`, `delete` and `deleteMany` fail; `deleteAuditRows` succeeds; a past `createdAt` is stored as now (UTC); two rows from one `createMany` differ.
    - Full suite green.
  - *Files:* `schema.prisma`, new migration, `tests/auditHardening.test.ts`. **M**
- [x] **Task 2: Single-connection tests of the switch and the flag**
  - *Acceptance:* on a `connection_limit=1` client over the direct URL, against a `TEMP` table with the same triggers:
    - `TRUNCATE` fails even under maintenance;
    - a switch set to another value, or set at session level, does not allow a delete;
    - after the committing transaction, the same backend cannot delete;
    - the switch without the flag does not allow a delete (drop the flag table, roll back).
  - The helpers' error says how to create the flag when it is missing.
  - *Verify:* `auditHardening.test.ts` green on the throwaway branch.
  - *Files:* `tests/auditHardening.test.ts`, `tests/helpers.ts`. **S**
  - *Depends on:* 1.
- [x] **Task 3: Session check**
  - *Acceptance:* `audit_logs_check_session` and its trigger are in the migration. A row naming another user's session, or a session that does not exist, is rejected. A `TEMP` table named `auth_sessions` does not satisfy the check. `auditSession.test.ts` (PR 1) still passes.
  - *Verify:* new cases in `auditHardening.test.ts`; full suite green.
  - *Files:* migration, `tests/auditHardening.test.ts`. **S**
  - *Depends on:* 1.

### Checkpoint A
- [x] Full API suite green on the throwaway branch after resetting it and applying the migration from scratch; `npm run check` clean.

### Phase 2: Foreign keys

- [x] **Task 4: Composite `RESTRICT` keys and `operator_id NOT NULL`**
  - *Acceptance:*
    - `@@unique([tenantId, id])` on `Patient` and `User`.
    - Composite relations for patient, author and target (spec §2).
    - `onDelete: Restrict, onUpdate: Restrict` on every audit foreign key; `operatorId` required.
    - Test code that deletes a user or operator who authored, or was targeted by, an audit row deletes those rows first.
  - *Verify:*
    - Deleting such a user or operator fails with `P2003`.
    - Through the base client, an audit row whose patient, author or target is another clinic's fails with `P2003`.
    - `auditTransactional.test.ts` unchanged and green; full suite green.
  - *Files:* `schema.prisma`, migration, `prismaPlatformRepository.ts` (if `operatorId` typing changes), `tests/auditHardening.test.ts`, test files that delete users. **M**
  - *Depends on:* 1.

### Phase 3: Checks

- [x] **Task 5: `audit-guards.sql` and `no-audit-maintenance.sql`, run in CI and on Render**
  - *Acceptance:*
    - Both files are written as specified in §1 *Checks*, with hashes taken from the throwaway branch.
    - `db:migrate:prod` becomes `no-audit-maintenance` → `migrate deploy` → `audit-guards`.
    - CI runs `audit-guards` after `migrate deploy` on `ci`.
  - *Verify:*
    - `audit-guards` passes on the throwaway branch.
    - The structure test (its table names replaced by `TEMP` copies) fails when a trigger is disabled, has a `WHEN` condition, or calls another function.
    - `no-audit-maintenance` fails on the throwaway branch (it has the flag) and passes on a scratch branch copied from `staging`, via the MCP.
  - *Files:* `prisma/audit-guards.sql`, `prisma/no-audit-maintenance.sql`, `apps/api/package.json`, `.github/workflows/test.yml`, `tests/auditHardening.test.ts`. **M**
  - *Depends on:* 3, 4.
- [x] **Task 6: Startup check**
  - *Acceptance:* `index.ts` (not `app.ts`) runs both checks after `listen`, through a repository method; `no-audit-maintenance` only when `NODE_ENV=production`. It logs "could not check" apart from "check failed", and never blocks or exits.
  - *Verify:* a unit test of the method's three outcomes (pass, fail, unreachable); `npm run dev:api` logs a pass on the throwaway branch.
  - *Files:* `src/index.ts`, new repository port and implementation, barrel, a test. **S**
  - *Depends on:* 5.

### Checkpoint B
- [x] Full suite green; both checks pass where expected and fail where expected.

### Phase 4: Guards in code and tooling

- [x] **Task 7: Migration-DDL scan and switch scan**
  - *Acceptance:* both tests exactly as in §1 *Who deletes, and how*.
    - The frozen list is every migration that exists when PR 2 merges, this one included. The allowlist starts empty.
    - The switch scan's file list adds `scripts/purge-test-audit.ts`.
  - *Verify:* both pass on today's files. A fixture migration with `DROP TRIGGER` on `audit_logs`, and a session-level `SET ficha.audit_maintenance` in a fixture file, each make them fail.
  - *Files:* two test files. **S**
- [x] **Task 8: Orphan purge script**
  - *Acceptance:* `scripts/purge-test-audit.ts` deletes the audit rows of `@test.ficha.local` clinics left by interrupted runs, inside the switch. It refuses to run without the flag (so never on `staging` or `production`).
  - *Verify:* a run on the throwaway branch removes planted orphans, and leaves the demo clinic's rows.
  - *Files:* the script, `apps/api/package.json` (script entry). **S**
  - *Depends on:* 1.

### Phase 5: Rehearsals and docs

- [x] **Task 9: Docs**
  - *Acceptance:*
    - `CLAUDE.md` replaces the "triggers have not landed yet" bullet. It covers the triggers, flag and switch (who may use them), `RESTRICT`, the checks, and the description rule (kept from PR 1).
    - `docs/infra.md` covers: the flag setup step for `development`/`ci` and why a reset from `production` drops it, the wipe procedure, the restore procedure, the line-ending rule, and `P3009` recovery.
  - *Files:* `CLAUDE.md`, `docs/infra.md`. **S**
- [x] **Task 10: Rehearsal on a copy of `production`**
  - *Acceptance:* on a branch copied from `production` (MCP):
    - the four §2 queries return 0;
    - the migration applies in one transaction;
    - `audit-guards` passes and `no-audit-maintenance` passes;
    - the old code's writes still succeed (an insert with a null session and a past date is stamped now).
  - The branch is deleted afterwards, with your permission.
  - **XS**, no files.
  - *Depends on:* 5.
- [x] **Task 11: Restore rehearsal** (see Open Questions)
  - *Acceptance:* a dump of the throwaway branch is restored into a scratch branch with the procedure in `docs/infra.md` (triggers disabled, one transaction with `ON_ERROR_STOP`, re-enabled). Row counts match and `audit-guards` passes.
  - **S**
  - *Depends on:* 9.

### Checkpoint C: complete
- [ ] PR against `dev` opened with a down script in its description; CI green, including `audit-guards` on `ci`.
- [ ] After merge, `staging` migrated and both checks passed in its Render build log.
- [ ] Throwaway branches deleted (with your permission).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A local branch older than PR 1 runs API tests against `development` after the triggers land | Its cleanup deletes audit rows without the switch, so its tests fail (no data loss) | Your two local branches touch no API tests. Rebase onto `dev` before running API tests |
| `pg_get_functiondef` output differs between branches | CI and Render builds fail | Same Neon project and Postgres version. The hash strips `\r`. A failure appears on `ci` before staging |
| Some test deletes a user who authored audit rows | Flaky `P2003` in cleanup | Task 4 greps every `user.delete*` / `platformOperator.delete*` in tests |
| `migrate reset` on `ci` (release PRs) drops `ficha_ops` | `ci` loses the flag, so test cleanup fails on release PRs | Verify on the throwaway branch that `migrate reset` keeps `ficha_ops`. If it drops it, the reset step re-creates the flag |
| A failed migration on Render leaves `P3009` | Every later deploy fails until `migrate resolve` runs | Rehearsal on a `production` copy first. Recovery documented in `docs/infra.md` |
| The startup check slows a cold start | Slower first request | It runs after `listen`, without `await` in the request path |

## Open Questions

1. **The throwaway branch's URL.** Do you agree to put it in `apps/api/.env.audit-pr2` (ignored by git), so it never passes through the chat?
2. **Restore rehearsal (Task 11).** This machine has neither `psql` nor `pg_dump`. Options:
   - (a) install the PostgreSQL client tools (`winget install PostgreSQL.PostgreSQL`, client only);
   - (b) rehearse it in the private backups repository, which already runs `pg_dump`, with a manual workflow against a scratch branch;
   - (c) defer it, documenting the procedure without a rehearsal.

   I recommend (a): it also lets me rehearse the wipe.
3. **Restore notes in `candiath/ficha-backups`.** The spec puts them there too. Should I open a PR in that repository, or do you write them?

## Decisions during implementation

- **`created_at` keeps millisecond precision (2026-10-10).** Moving it to `timestamp(6)` broke every audit query on the throwaway branch with `cached plan must not change result type`. Neon's pooler shares prepared statements across clients, and a column type change invalidates their result type until its server connections recycle. On `staging` or `production` that would fail every audited write (the insert returns `created_at`) for a while after the deploy. Readers already order by `created_at`, then `id`. The test of "two rows of one `createMany` differ" became "two inserts in one transaction keep their gap", which is what proves `clock_timestamp()`.
- **Restore rehearsal in a GitHub Actions runner (2026-10-10).** This machine has no `psql`, `pg_dump` or Docker. A one-off workflow on a throwaway branch (deleted after the run) migrated and seeded a Postgres 16 service container, dumped it with the backups repository's exact flags, and restored it with and without the procedure: [run 38083672334](https://github.com/candiath/ficha/actions/runs/38083672334). No secrets, only seed data.
- **The trigger WHEN condition is hashed in `audit-guards.sql`**: `pg_get_expr` cannot print one that reads both `NEW` and `OLD`.
- **`migrate reset` keeps `ficha_ops`** (checked on the throwaway branch), so release PRs, which reset `ci`, keep its flag.
- **Rehearsal on a copy of `production`**: both pending migrations applied in order, the four §2 queries returned 0 there and on `staging`, `development` and `ci`, the function hashes matched the throwaway branch, and an old-code insert (null session, past date) was stamped now while an `UPDATE` was rejected.
