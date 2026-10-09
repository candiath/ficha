# Implementation Plan: audit-hardening, first PR (preparation)

Spec: [`SPEC-audit-hardening.md`](SPEC-audit-hardening.md) (approved 2026-10-09), *Rollout* step 1. Module 1 of the [audit map](audit-map.md). Task checklist: below. The second PR (triggers, foreign keys, checks) gets its own plan once this one is merged.

## Overview

Everything the hardening needs that cannot break another branch or the code still serving:
- one additive migration (the nullable `auth_session_id`), written through `TenantContext`;
- all test cleanup of audit rows moved onto helpers;
- descriptions without values;
- the platform audit list resolving its target;
- the seed and repository hygiene.

The PR goes against `dev` from `feat/audit-hardening-prep`, with one commit per task and the full local API suite before the push.

**Prerequisite:** #205 merged into `dev` (the branch starts after it), so hand-built contexts in tests are typechecked.

## Architecture Decisions

- **Column first.** `insertAuditRowsAt` and the seed write rows that name a session, so the column and `TenantContext.authSessionId` come before the helpers.
- **Helpers are inert until the triggers exist.** They already set the switch (`set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`), which nothing reads yet. When the triggers land, no test file has to change again.
- **Plans live in `docs/specs/`**, like the previous modules. `tasks/` still holds the password-reset plan; it is left untouched.

## Task List

- [ ] **Task 1: `auth_session_id` column, written from the request's session**
  - *Acceptance:* migration adds `audit_logs.auth_session_id uuid NULL` (nothing else); `TenantContext.authSessionId: string`, filled by `authenticate`; `req.authSessionId` removed and its readers (`routes/auth.ts`) use `req.context.authSessionId`; `recordAudit` writes it; `AuditLogDTO` does not expose it.
  - *Verify:* new test: `POST /api/patients` with a real session stores that session's id, and `GET …/audit-log` does not return it; `auth*`/`myDevices` tests green; `migrate diff --exit-code` 0.
  - *Files:* `schema.prisma`, new migration, `repositories/types.ts`, `middlewares/auth.ts`, `types/express.d.ts`, `routes/auth.ts`, `recordAudit.ts`, a test. **M**
- [ ] **Task 2: Hand-built test contexts carry a real session**
  - *Acceptance:* a helper creates a session and returns a full `TenantContext`; the 9 test files that build one by hand use it.
  - *Verify:* `npm run typecheck -w apps/api` clean; those 9 files green.
  - *Files:* `tests/helpers.ts` + 9 test files (mechanical). **M**
  - *Depends on:* 1.
- [ ] **Task 3: Audit helpers**
  - *Acceptance:* `deleteAuditRows(tenantIds)` (both tables), `deleteOperatorAuditRows(operatorId)` and `insertAuditRowsAt(rows)` in `tests/helpers.ts`, each one transaction with the switch; an empty list throws; `auditLog.test.ts` backdates through `insertAuditRowsAt`.
  - *Verify:* `auditLog.test.ts` and a helper test (empty list throws) green.
  - *Files:* `tests/helpers.ts`, `tests/auditLog.test.ts`. **S**
  - *Depends on:* 1.
- [ ] **Task 4: All cleanup through the helpers**
  - *Acceptance:* no test file calls `auditLog.deleteMany` or `platformAuditLog.deleteMany` directly (27 files plus `helpers.ts` cleanups, `platform.test.ts`).
  - *Verify:* `grep` finds none outside the helpers; full API suite green.
  - *Files:* the 27 test files (mechanical, one pattern). **L, mechanical**
  - *Depends on:* 3.

### Checkpoint A
- [ ] Full API suite green locally; `npm run check` clean.

- [ ] **Task 5: Clinical descriptions without values**
  - *Acceptance:* session create, scale and payment create carry no pain, score or amount; payment update says `Cobro actualizado` without the unconditional status; comment on `AuditEntry` states the rule.
  - *Verify:* tests pin the new wordings, including that a session with pain values, a scale with a score and a payment with an amount carry none of them (`sessionsCrud.test.ts:639` updated).
  - *Files:* `routes/sessions.ts`, `routes/functionalScales.ts`, `routes/payments.ts`, `auditLogRepository.ts`, tests. **M**
- [ ] **Task 6: Platform descriptions without names; the list resolves the target**
  - *Acceptance:* `prismaPlatformRepository` wordings without emails or clinic names (the new role stays); `PlatformAuditLogDTO.targetUser: { email, name } | null` from a join; readers order by `createdAt`, then `id`; the tenant detail page shows the target next to the description.
  - *Verify:* `platform.test.ts`, `disconnectDevices.test.ts:160`, `passwordReset.test.ts:226` updated and green; web test for the list; manual check in the platform UI (skill `verify`).
  - *Files:* `prismaPlatformRepository.ts`, `platformRepository.ts`, `PlatformTenantDetailPage.tsx`, web service type, tests. **M**
- [ ] **Task 7: Seed**
  - *Acceptance:* demo audit history via `createMany({ skipDuplicates: true })` inside a transaction with the switch; rows point at one expired session of the demo user; descriptions follow the rule; the seed refuses to run when a user outside its own and the test domains exists.
  - *Verify:* `npm run db:seed` on `development` twice in a row; the guard refuses on a copy with a foreign user (test of the guard function).
  - *Files:* `prisma/seed.ts`, a test. **S**
  - *Depends on:* 1, 3.

### Checkpoint B
- [ ] Full API and web suites green; seed re-runnable.

- [ ] **Task 8: Line endings and CI's direct URL**
  - *Acceptance:* `.gitattributes` gains `apps/api/prisma/**/*.sql text eol=lf` (renormalized); CI's test step exports `DIRECT_DATABASE_URL` like the migrate steps.
  - *Verify:* `git ls-files --eol apps/api/prisma` shows `w/lf` after a fresh checkout; CI green.
  - *Files:* `.gitattributes`, `.github/workflows/test.yml`. **XS**
- [ ] **Task 9: Docs**
  - *Acceptance:* `CLAUDE.md` describes `TenantContext.authSessionId`, the audit helpers as the only way tests touch audit rows, and the description rule.
  - *Files:* `CLAUDE.md`. **XS**

### Checkpoint C: complete
- [ ] PR against `dev` open, CI green; nothing in it can break another branch or the code serving (only an added nullable column).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Renormalizing `.sql` changes how migrations look on disk | Low | The index is already LF; only the working tree changes. `migrate deploy` does not compare checksums |
| The seed guard blocks `development`, which may hold test orphans | Med | Test domains are allowed; the guard names the offending users |
| Some code path builds a `TenantContext` outside `authenticate` | Med | Non-null type: `tsc` finds every one (src and, after #205, tests) |
| Exact-text assertions missed in the inventory | Low | Full suite before the push |

## Open Questions

None blocking.
