# Implementation Plan: sysadmin-alerts

Spec: [`SPEC-sysadmin-alerts.md`](SPEC-sysadmin-alerts.md) (approved 2026-10-11). Map: [`audit-map.md`](audit-map.md).

## Overview

Telegram alerts to the platform operator. The plan covers:

- two append-only audit tables;
- a Telegram client that never throws and never leaks the token;
- an alerts service with retries;
- the startup audit check as the first producer;
- three operator routes and the *Alertas* card with its banner.

It all lands in one PR against `dev`. The migration is developed on a throwaway Neon branch and rehearsed on a copy of `production` before the PR opens.

## Architecture Decisions

- **One migration, rebuilt until final.** Each time it changes, the throwaway branch is reset from its parent and the migration re-applied: `migrate deploy` never re-applies an edited migration, and the shared branches never see a draft.
- **The throwaway branch's URL never enters the chat.** A script copies `DATABASE_URL` and `DIRECT_DATABASE_URL` from `apps/api/.env` into `apps/api/.env.sysadmin-alerts` (ignored by `.env.*`), swapping only the endpoint id for the throwaway branch's. Neon copies the role and its password to a child branch. Commands load that file into their environment (`set -a; . apps/api/.env.sysadmin-alerts`), and dotenv does not override variables already set. Nothing prints the URL.
- **The `production` rehearsal goes through the Neon MCP**: a branch copied from `production`, the migration through `run_sql_transaction`, then both check files through `run_sql`.
- **The Telegram client is pure and injected.** `src/lib/telegram.ts` takes `fetch` and the config as arguments, so its tests need no database and no network. The service binds `fetch` and `process.env` late, so route tests reach it with `vi.stubGlobal` and `vi.stubEnv`.
- **The banner rule is a pure function** in the repository module, so it is tested without the shared table.

## Task List

### Phase 0: Setup

- [ ] **Task 0: Throwaway branch**
  - *Acceptance:*
    - Neon branch `sysadmin-alerts` is created from `development`, so it inherits the maintenance flag;
    - `apps/api/.env.sysadmin-alerts` points at it, written by a script that prints nothing secret;
    - a `SELECT 1` through Prisma with that environment works.
  - *Files:* none in the repo. **XS**

### Phase 1: The tables (highest risk first)

- [ ] **Task 1: Schema, migration and the migration scan**
  - *Acceptance:*
    - Schema and migration as spec §1 and §2:
      - the lock comes first;
      - two enums and two tables;
      - six triggers, calling the existing functions;
      - four `CHECK`s;
      - `platform_audit_logs.tenant_id` becomes nullable;
      - `TEST_ALERT_SENT` is added.
    - `migrate diff --exit-code` reports 0 on the throwaway branch.
    - `auditMigrationScan.test.ts`:
      - `ALLOWED` becomes `{ reason, violations }`, and this migration is on it with its exact violations;
      - `AUDIT_NAMES` gains the new names;
      - a test proves an extra violation in an allowed migration fails.
    - Helpers: `deleteSysadminAlerts(ids)`, and `deleteOperatorAuditRows` also deletes the operator's test alerts.
    - `PlatformAuditLogDTO.tenantId` and the shared type become `string | null`, and the `PlatformAuditLog` reason in `tenantScope.ts` is updated, with a comment on the alert tables.
  - *Verify:* new `tests/sysadminAlertTables.test.ts`, on its own rows:
    - `update`, `delete` and `deleteMany` rejected on both tables;
    - `created_at` stamped;
    - the helper can delete;
    - each `CHECK` rejects its bad row;
    - `RESTRICT` on the operator.

    Plus the migration scan, `tenantScopeCoverage`, `platform.test.ts` and `npm run check`.
  - *Files:* `schema.prisma`, the migration, `tests/auditMigrationScan.test.ts`, `tests/helpers.ts`, `tests/sysadminAlertTables.test.ts`, `src/lib/tenantScope.ts`, `platformRepository.ts`, `packages/shared/src/index.ts`. **M** (the type change is one line each)
- [ ] **Task 2: Guards pin the new tables; "unreachable" narrowed**
  - *Acceptance:*
    - `audit-guards.sql`:
      - resolves tables with `to_regclass` and reports a missing one;
      - pins the triggers and foreign keys of both new tables, the four `CHECK`s (by name, definition and `convalidated`) and the `NOT NULL`s on `kind`, `outcome` and `alert_id`.
    - `prismaAuditGuardRepository` returns `unreachable` only for connection errors (`PrismaClientInitializationError`, `P1001`, `P1002`, `P1008`, `P1017`).
  - *Verify:*
    - `auditHardening.test.ts` passes on the deployed tables and on the TEMP copies;
    - `auditGuardRepository.test.ts` gains a non-connection error that is `failed` and a connection error that is `unreachable`.
  - *Files:* `prisma/audit-guards.sql`, `prismaAuditGuardRepository.ts`, `tests/auditGuardRepository.test.ts`. **S**
  - *Depends on:* 1.

### Checkpoint A

- [ ] The migration is final enough to rehearse. Reset the throwaway branch, re-apply, and the Phase 1 tests pass.

### Phase 2: Telegram and the service

- [ ] **Task 3: Telegram client, and tests never reach Telegram**
  - *Acceptance:* `src/lib/telegram.ts` as spec §3: `readTelegramConfig`, `sendTelegramMessage`, `getTelegramBot` and `redact`. `tests/setup.ts`:
    - deletes the Telegram variables and `RENDER_SERVICE_NAME`;
    - guards `fetch` against `api.telegram.org`, with a message that does not repeat the URL.
  - *Verify:* `tests/telegram.test.ts`, with every case in the spec's *Testing Strategy*, the leak cases included. No database.
  - *Files:* `src/lib/telegram.ts`, `tests/telegram.test.ts`, `tests/setup.ts`. **S**
- [ ] **Task 4: Repository and the banner rule**
  - *Acceptance:*
    - The port and the Prisma implementation: `createAlert`, `createTestAlert` (the alert and the platform audit row in one transaction), `recordDelivery` and `overview` (spec §5).
    - The pure `undeliveredAlert()`.
    - The barrel exports it, and `CLAUDE.md` gets the exception later (Task 8).
  - *Verify:*
    - `tests/sysadminAlertRepository.test.ts` on its own ids: a test alert writes both rows, with no clinic and no target; `overview` returns its real alert with its latest delivery and count, and its test as the last test, outside the list.
    - `undeliveredAlert` unit cases (spec).
  - *Files:* `repositories/sysadminAlertRepository.ts`, `repositories/prisma/prismaSysadminAlertRepository.ts`, `repositories/index.ts`, `tests/sysadminAlertRepository.test.ts`. **M**
  - *Depends on:* 1.
- [ ] **Task 5: Alerts service**
  - *Acceptance:* `src/lib/sysadminAlerts.ts` as spec §4:
    - `raise` with retries, never rejecting;
    - `sendTest`;
    - `status`, and `bot` with its cache;
    - the message templates and the label.
  - *Verify:* `tests/sysadminAlerts.test.ts`, with a fake `fetch` and a fake `sleep`:
    - `SENT`;
    - `429`, then success;
    - three `UNREACHABLE`;
    - `401`, with no retry;
    - not configured, with `fetch` never called;
    - repository and `fetch` both throwing: it resolves, the message is still sent, and no token is logged;
    - the message text;
    - the `getMe` cache.
  - *Files:* `src/lib/sysadminAlerts.ts`, `tests/sysadminAlerts.test.ts`. **S**
  - *Depends on:* 3, 4.
- [ ] **Task 6: Startup producer**
  - *Acceptance:*
    - `checkAuditGuardsAtStartup` raises on a failed check, awaits `raise` inside its own `try/catch`, and raises nothing on `unreachable`;
    - `index.ts` logs the Telegram configuration.
  - *Verify:* new `tests/auditGuards.test.ts`, with a fake repository and a fake `raise`:
    - each failed file raises its kind;
    - `passed` and `unreachable` raise nothing;
    - a rejecting `raise` leaves no unhandled rejection.
  - *Files:* `src/lib/auditGuards.ts`, `src/index.ts`, `tests/auditGuards.test.ts`. **S**
  - *Depends on:* 2, 5.

### Phase 3: Routes and UI

- [ ] **Task 7: Routes**
  - *Acceptance:*
    - `createPlatformAlertsRouter({ testLimitPerMinute })`, mounted in `app.ts` before `/api/platform` with 50 per minute, keyed globally;
    - the manifest entry for `POST /api/platform/alerts/test`.
  - *Verify:* `tests/platformAlerts.test.ts`, with every route case in the spec; `auditCoverage.test.ts`; `idParamCoverage.test.ts`.
  - *Files:* `src/routes/platformAlerts.ts`, `src/app.ts`, `tests/auditCoverageManifest.ts`, `tests/platformAlerts.test.ts`. **M**
  - *Depends on:* 5.
- [ ] **Task 8: Web card and banner**
  - *Acceptance:*
    - shared types;
    - `platformAlertsApi` and query keys;
    - `AlertsCard` at the end of `PlatformTenantsPage`;
    - `UndeliveredAlertBanner` in `PlatformLayout`.

    All copy is in Spanish.
  - *Verify:* `apps/web/tests/AlertsCard.test.tsx` and `UndeliveredAlertBanner.test.tsx`; `npm test -w apps/web`; `npm run check`. Also a manual look through the `verify` skill, local API and web, with a fake configuration to see "no configurado" and the disabled button.
  - *Files:* `packages/shared/src/index.ts`, `apps/web/src/services/platform.ts`, `apps/web/src/components/platform/AlertsCard.tsx`, `apps/web/src/components/platform/UndeliveredAlertBanner.tsx`, `PlatformTenantsPage.tsx`, `PlatformLayout.tsx`, two tests. **M** (two small components)
  - *Depends on:* 7.

### Checkpoint B

- [ ] Full local suites on the throwaway branch: `npm test`, `npm test -w apps/web`, `npm run check`.

### Phase 4: Docs, purge, rehearsal, PR

- [ ] **Task 9: Purge script and docs**
  - *Acceptance:*
    - `purge-test-audit.ts` also deletes alerts older than an hour, with their deliveries.
    - Docs:
      - `CLAUDE.md`: the audit tables, the repository without a `ctx`, the operator's list, the variables;
      - `docs/infra.md`: Telegram setup, the local `.env` rule, `NODE_DEBUG`, rotation, the restore with four tables;
      - `audit-map.md`: the row, with rate limiting deferred;
      - `.env.example`.
  - *Verify:* `npm run purge:test-audit -w apps/api` against the throwaway branch reports a count and fails nowhere.
  - *Files:* `scripts/purge-test-audit.ts`, `CLAUDE.md`, `docs/infra.md`, `docs/specs/audit-map.md`, `apps/api/.env.example`. **S**
- [ ] **Task 10: Rehearsal on a copy of `production`**
  - *Acceptance:* on a Neon branch from `production`:
    - `no-audit-maintenance.sql` passes before the migration;
    - the migration applies in one transaction;
    - `audit-guards.sql` passes after it;
    - row counts of `platform_audit_logs` are unchanged.
  - *Verify:* the MCP outputs, quoted in the PR description.
  - *Files:* none. **XS**
- [ ] **Task 11: PR**
  - *Acceptance:*
    - the full local suites pass right before the push;
    - PR against `dev` (`gh pr create -B dev`), auto-merge with a merge commit once `test` passes, Auto-fix on;
    - after the merge, the migration is applied to `development` (`migrate deploy`), which the local tests use;
    - the throwaway branches are deleted.
  - *Files:* none.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Prisma's diff drops and re-adds the platform audit foreign keys when `tenant_id` turns optional | Medium: more violations on `ALLOWED`, longer locks | The lock comes first; the exact violations are pinned; the rehearsal on `production` times it. |
| A `CHECK` naming `TEST_ALERT_SENT` in the migration that adds it | High: the migration fails | Compared as text (`action::text`), as the spec says; the throwaway branch proves it before anything shared sees it. |
| A test reaches the real Telegram (Nath's `.env` will hold a token) | High: a message from CI or a laptop, with a token in its logs | `tests/setup.ts` deletes the variables and blocks the host before any test file loads. |
| Shared-table assertions flake on `ci` | Medium | Tests assert only on their own ids; the banner is a pure function. |
| CI applied a draft of the migration to `ci` | Medium | The PR opens only once the migration is final. If it changes later, use the `reset_ci_db` dispatch. |

## Out of Scope

- Rate limiting alerts per kind: deferred (the map's row says so).
- Other producers: `record-access-log` and `security-events` add their kinds.
- Retention of the alert tables: it waits on the map's legal question.
