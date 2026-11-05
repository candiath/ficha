# Implementation Plan: clinical-revisions

Spec: [`SPEC-clinical-revisions.md`](SPEC-clinical-revisions.md) (approved 2026-11-01), *Rollout* steps 0 to 6. Map: [`audit-map.md`](audit-map.md).

## Overview

Every write to a clinical aggregate stores a snapshot of its new state in an append-only revisions table, in the same transaction as the write and its audit row. Concurrent edits get a `409`, a no-op save writes nothing, and the record can show every past version.

Seven PRs against `dev`, one per rollout step, in order. Each one leaves `dev` working: the API and the web change together in every step that changes a request. All seven land before the relaunch's wipe (#238).

## Architecture Decisions

- **Step 0 blocks nothing in steps 1–6.** No later step needs Postgres 18: revision ids come from the app, the baseline is TypeScript (spec §10), and `uuidv7()` is only for future SQL data migrations. Step 0 goes first in the spec's order, but it can run alongside steps 1 and 2. It only has to finish before the relaunch.
- **Postgres 18 is a new Neon project** (decided 2026-11-01). Each branch moves by dump and restore, with the procedure in `docs/infra.md`, which gets proven on 18 along the way; `ci` starts empty. The URLs never enter the chat: you put them in an ignored env file, and commands load it.
- **The `reason` parameter is attached per aggregate, in the step that versions it** (2, 3, 5), not all in step 1. The catalog validates writes strictly, so a parameter added to `SESSION_UPDATED` is required from that commit on, and every session edit would fail until the form sends it. Step 1 adds only the list of reason codes. This departs from the spec's rollout line for step 1; the step 2 PR updates the spec.
- **Test cleanup goes through `deleteAuditRows`.** Revisions reference their audit row with `RESTRICT`, so `deleteAuditRows(tenantIds)` has to delete the clinics' revisions first anyway, in the same maintenance transaction. Most of the 35 files that hard-delete clinical rows already call it first and need no change. Only tests that delete clinical rows before the audit rows, or delete one aggregate in the middle of a file, change: the second kind gets `deleteRevisions(table, ids)`. This replaces the spec's "the ~35 files call `deleteRevisions`".
- **One migration per PR, rebuilt until final.** It is written with `prisma migrate diff` plus hand-written SQL (`migrate dev` hangs without a TTY) and applied from empty by `npm test` on Docker each run. Steps 1, 2, 3, 5 and 6 add one migration each. Before each of those PRs opens, the migration is rehearsed on a Neon branch copied from `production` through the MCP (`run_sql_transaction`, then `audit-guards.sql` through `run_sql`). The branch is deleted afterwards.
- **An aggregate with no revision is version 0.** Rows created before its step (staging, development, the production trial) have none. Their first edit writes version 1 with the new state, and the baseline (step 6) writes version 1 for the rest. Nothing refuses a write for lack of history.
- **Fixtures follow the step.** The invariant helper checks an aggregate only from the step that versions it. That step switches the fixtures that insert that aggregate directly to a helper that also writes version 1. Today that is 115 direct writes across 29 test files, spread over steps 2 and 3.
- **Docs go with each PR**, not at the end: each step can be released on its own, and `CLAUDE.md` and `docs/infra.md` must describe what `main` runs.

## Task List

### Step 0: Postgres 18 (PR 0)

- [x] **Task 0.1: The new Neon project**
  - *Acceptance:*
    - A new project on Postgres 18, in the current project's region, with the same compute and history-retention settings. You create it, or I do it through the MCP with your permission.
    - Its root branch will be `production`. `staging`, `development` and `ci` are created while the root is still empty, so they inherit nothing from it.
    - You put the old and new URLs of each branch in `apps/api/.env.pg18` (ignored by `.env.*`). Commands load that file, and nothing prints a URL.
  - *Files:* none in the repo. **XS**
- [x] **Task 0.2: The test container and CI on 18**
  - *Acceptance:*
    - `docker-compose.yml` uses `postgres:18`. The tmpfs moves to `/var/lib/postgresql`: the 18 image keeps its data in `/var/lib/postgresql/18/docker`, so a mount at the old `.../data` no longer holds it (check what its entrypoint does with one).
    - The full API suite passes on it.
    - `audit-guards.sql` passes on it. If `pg_get_functiondef` prints differently on 18, the function hashes differ, and the file accepts both the 16 and the 18 hashes until every branch, `production` included, is on 18. A follow-up then drops the 16 set.
  - *Verify:* `npm test` (it runs `audit-guards.sql` before vitest).
  - *Files:* `docker-compose.yml`, maybe `prisma/audit-guards.sql`. **S**
- [x] **Task 0.3: Rehearsal on the new project**
  - *Acceptance:*
    - On its `ci` branch, with the maintenance flag created:
      - the migration chain applies from empty;
      - `audit-guards.sql` passes, and `no-audit-maintenance.sql` fails, as it should with the flag;
      - `npm run test:neon` passes, through the pooler.
    - A dump of the old `staging` restores into a throwaway branch of the new project with the procedure in `docs/infra.md` (triggers disabled, one transaction, `ON_ERROR_STOP`). Row counts match table by table, and `audit-guards.sql` passes.
    - `pg_dump` and `psql` run from the `postgres:18` image through Docker, since this machine has no client tools.
  - The throwaway branch is deleted afterwards, with your permission.
  - *Files:* none. **S**
  - *Depends on:* 0.1, 0.2.
- [x] **Task 0.4: `staging`, `development` and `ci` on 18**
  - *Acceptance:*
    - `staging` and `development` are restored from dumps of the old branches with the rehearsed procedure, and their row counts match. `ci` stays empty and is migrated.
    - `ficha-staging` on Render, the local `apps/api/.env` and the `CI_DATABASE_URL` secret point at the new project. You change Render and the secret; I give you the names, never the URLs.
    - `development` and `ci` get the maintenance flag; `staging` does not.
    - The memory note on infrastructure ids is updated.
    - After the switch, the staging deploy's build log shows `migrate:prod` and both checks passing.
  - *Files:* none in the repo. **S**
  - *Depends on:* 0.3.
- [ ] **Task 0.5: `production` on 18, before the relaunch**
  - *Acceptance:*
    - The move happens in a window agreed with the clinic:
      - a manual run of the backup workflow takes the old project's last dump;
      - the `Ficha` service stays suspended from the dump to the switch, so no write lands in the old project after it.
    - The new project's root branch becomes `production`, restored from a dump of the old one with the rehearsed procedure.
      - Row counts match table by table.
      - `audit-guards.sql` and `no-audit-maintenance.sql` both pass: `production` gets no maintenance flag.
    - The dump is taken by a one-off workflow in the backups repository and lives only in its container. It holds the trial's data, which is handled as if it were real.
    - The `Ficha` service on Render and the backups repository's credential point at the new project. Then:
      - the service is resumed;
      - the production deploy's build log shows `migrate:prod` and both checks passing;
      - a manual run of the backup workflow produces the new project's first dump.
    - If anything fails before the switch, the old project still holds everything: resuming the service is the whole rollback.
    - Only after all that is the old project deleted, with your permission.
  - *Files:* none. **S**
  - *Depends on:* 0.4.
- [x] **Task 0.6: Docs and PR**
  - *Acceptance:*
    - `docs/infra.md` (the new project, the local test database, the restore procedure, the version) and the comment in `docker-compose.yml` say 18.
    - PR against `dev`. `test.yml` needs no change if the job runs only `docker compose`. PR #271 also touches `test.yml`; whichever lands second rebases.
  - *Files:* `docs/infra.md`, `docker-compose.yml`. **XS**
  - *Depends on:* 0.2. Tasks 0.4 and 0.5 can follow the merge.

### Checkpoint 0

- [ ] Every Neon branch and the test container run 18; `audit-guards.sql` passes on all of them; CI is green on a PR to `dev` and on a manual run on `ci`.

### Step 1: Prerequisites (PR 1)

- [x] **Task 1.1: Composite unique keys**
  - *Acceptance:*
    - One migration adds `@@unique([tenantId, patientId, id])` to `AuditLog`, `InitialEvaluation`, `InformedConsent` and `PatientEvent`.
    - `auditMigrationScan.test.ts`: an `ALLOWED` entry for this migration, with its exact violations (DDL on `audit_logs`).
    - `audit-guards.sql`: new expected values, if it pins the constraints of `audit_logs`.
    - Rehearsed on a copy of `production`: it applies in one transaction, and row counts are unchanged.
  - *Verify:* `npm test -- auditMigrationScan auditHardening modelIntegrity`; `npm run check`.
  - *Files:* `schema.prisma`, the migration, `tests/auditMigrationScan.test.ts`, maybe `prisma/audit-guards.sql`. **S**
- [x] **Task 1.2: `recordAudit` returns its id; more lockable tables**
  - *Acceptance:*
    - `recordAudit` returns the id of the row it inserted. Existing callers ignore it.
    - `LOCKABLE` gains `clinical_episodes: 'id'`, `informed_consents: 'patient_id'` (one per patient) and `patient_events: 'id'`.
  - *Verify:* `npm test -- auditTransactional auditEntries`; `npm run check`.
  - *Files:* `repositories/prisma/recordAudit.ts`, `repositories/prisma/changedFields.ts`. **XS**
- [x] **Task 1.3: Episodes audited** (the episode part of `clinical-audit-coverage`)
  - *Acceptance:*
    - `AuditEntity` gains `EPISODE` (in the same migration as Task 1.1). The catalog gains (spec §4):
      - `EPISODE_OPENED`;
      - `EPISODE_CLOSED`, with its status (a new `AUDIT_EPISODE_STATUSES`: `DISCHARGED`, `ABANDONED`);
      - `EPISODE_REOPENED`;
      - `EPISODE_UPDATED`, for corrections of the complaint or the dates only (`changedFields` over a new `AUDIT_EPISODE_FIELDS`).
    - The `PATCH` picks the action: a status change records `EPISODE_CLOSED` or `EPISODE_REOPENED`, a correction records `EPISODE_UPDATED`, and a request that does both answers `400`.
    - `episodeRepository.create` and `update` write in a transaction with their audit row (`AuditBuilder`, as `patientRepository` does). `update` locks the row and records `changedFields`; an update that changes nothing records nothing.
    - The two episode routes move from `debt` to `audited` in `auditCoverageManifest.ts`.
    - `audit-map.md`: the `clinical-audit-coverage` row says episodes are done here.
  - *Verify:* `npm test -- episodes auditEntries auditCoverage auditTransactional`. The new tests cover: create records one row; abandon and reopen record their own actions; a correction records its changed fields; a request with both answers `400` and writes nothing; a no-op records nothing; a forced audit failure rolls the episode back. Plus `npm run check`.
  - *Files:* `schema.prisma` + migration, `packages/shared/src/auditActions.ts`, `repositories/episodeRepository.ts`, `repositories/prisma/prismaEpisodeRepository.ts`, `routes/episodes.ts`, `tests/auditCoverageManifest.ts`, `tests/episodes.test.ts`, `docs/specs/audit-map.md`. **M**
  - *Depends on:* 1.1.
- [x] **Task 1.4: Reason codes and PR**
  - *Acceptance:*
    - The catalog gains `AUDIT_REVISION_REASONS` (`DATA_ENTRY_ERROR` "Error de confección", `LATE_INFORMATION`, `CLARIFICATION`, `OTHER`), attached to no action yet.
    - `packages/shared` exports the request schema for a reason and an optional note, reused by every route from step 2 on.
    - Full local suites, then a PR against `dev`.
    - After the merge (pending): `migrate deploy` on `development`, and the staging build log shows both checks passing.
  - *Verify:* `npm test -- auditCatalog`; `npm test`; `npm test -w apps/web`; `npm run check`.
  - *Files:* `packages/shared/src/auditActions.ts`, `packages/shared/src/index.ts`. **XS**

### Checkpoint 1

- [ ] Episodes leave audit rows; the four unique keys exist on `staging`; nothing visible changed for users.

### Step 2: Session revisions (PR 2, highest risk)

- [ ] **Task 2.1: The `session_revisions` table**
  - *Acceptance:*
    - Model and migration as spec §2:
      - composite `RESTRICT` keys to `sessions` and `audit_logs`;
      - `UNIQUE (session_id, version)` and `CHECK (version >= 1)`;
      - `*_append_only` and `*_no_truncate` triggers that call the existing audit functions.
    - Classified in `TENANT_SCOPED_MODELS`.
    - `audit-guards.sql` pins the table, its triggers, foreign keys, `CHECK` and `NOT NULL`s. The migration scan's `AUDIT_NAMES` gains it.
    - `deleteAuditRows` deletes the clinics' revisions first; `deleteRevisions(table, ids)` exists for mid-file deletes. Tests that delete sessions before the audit rows are reordered.
  - *Verify:* a new `tests/sessionRevisionsTable.test.ts`, on its own rows:
    - `update`, `delete` and `TRUNCATE` are rejected;
    - the helper can delete;
    - `RESTRICT` holds on the session and on the audit row;
    - a revision naming another clinic's or another patient's audit row fails.

    Plus `tenantScopeCoverage`, `auditHardening`, the migration scan, and the full suite (for the cleanup order).
  - *Files:* `schema.prisma` + migration, `src/lib/tenantScope.ts`, `prisma/audit-guards.sql`, `tests/auditMigrationScan.test.ts`, `tests/helpers.ts`, the new test. **M**
- [ ] **Task 2.2: Session snapshot and projection coverage**
  - *Acceptance:*
    - Session projection, as spec §3: the field list and the excluded columns. It holds `userId`, the type, the date, the observations and the blocks ordered by `episodeId`.
    - `SessionSnapshotV1` is a `strictObject` in `packages/shared`, as a new runtime module, added to the list in `CLAUDE.md`.
    - `tests/historyProjectionCoverage.test.ts`: every column of `sessions` and `session_episodes` is in the projection or in the exclusion list (from the DMMF).
    - A fixture test proves a v1 snapshot parses.
  - *Verify:* `npm test -- historyProjectionCoverage`; a column added to `Session` by hand makes it fail (checked once, reverted).
  - *Files:* `packages/shared/src/clinicalSnapshots.ts` (new), `packages/shared/src/index.ts`, `tests/historyProjectionCoverage.test.ts`, `CLAUDE.md`. **S**
- [ ] **Task 2.3: `recordRevision` and the session write path**
  - *Acceptance:*
    - `recordRevision(tx, ctx, …)` sits next to `recordAudit`.
    - `create` writes version 1, linked to the `*_RECORDED` audit row.
    - `update` follows spec §5:
      - lock the session;
      - read the latest revision;
      - build the projection and compare it with the latest snapshot. If they are equal, write nothing at all: the forced `updatedAt` and the rewrite of unchanged blocks go away;
      - otherwise write the rows, then the audit row, then version N+1.
    - `softDelete` writes a version under `SESSION_DELETED`, with the snapshot unchanged. Step 5 turns it into the annulment.
    - The record's DTOs (`getById`, `listByPatient`) carry `version`; a session with no revision is 0.
    - A failed revision insert rolls the whole action back, and is logged as code, table and id only (spec §11).
  - *Verify:* `tests/sessionRevisions.test.ts`:
    - creation writes v1;
    - an edit writes N+1 with the right snapshot and audit row;
    - removing a block shows in the next snapshot;
    - a no-op `PATCH` answers `200` and writes no row, no audit row and no revision;
    - a forced revision failure rolls the edit back, and the log holds no marker text.

    Plus `sessionsCrud`, `sessionPatchPartial`, `sessionEpisodeBlocks`, `auditEntries`.
  - *Files:* `repositories/prisma/recordRevision.ts` (new), `repositories/prisma/prismaSessionRepository.ts`, `repositories/sessionRepository.ts`, `packages/shared/src/index.ts` (`Session.version`), the new test. **M**
  - *Depends on:* 2.1, 2.2.
- [ ] **Task 2.4: Stale edits and the reason (API)**
  - *Acceptance:*
    - The `PATCH` body takes `expectedVersion` (optional), `reason` (required, a code) and `reasonNote` (optional, `optionalText`).
    - A stale `expectedVersion` returns `{ ok: false, reason: 'stale' }`, and the route answers `409` "Otra persona editó este registro. Recargá para ver los cambios.".
    - `SESSION_UPDATED` gains the `reason` parameter, and `reason_note` is stored on the revision.
  - *Verify:*
    - a stale version answers `409` and writes nothing;
    - two concurrent edits with the same `expectedVersion` give one `200` and one `409`; without it, two consecutive versions; never a lost write;
    - a missing reason answers `400`.
  - *Files:* `routes/sessions.ts`, `packages/shared/src/auditActions.ts`, `prismaSessionRepository.ts`, `tests/sessionRevisions.test.ts`. **S**
  - *Depends on:* 2.3.
- [ ] **Task 2.5: Stale edits and the reason (web)**
  - *Acceptance:*
    - Editing a session in `SessionFormModalWide` sends the version it loaded, plus a reason select ("Error de confección" preselected) and an optional note. Creating one sends neither.
    - A `409` shows the API's message, keeps what was typed, and offers to reload.
  - *Verify:* `npm test -w apps/web -- SessionFormModalWide`: the body carries `expectedVersion` and `reason`, a `409` shows the message, and an untouched save still sends the loaded values.
  - *Files:* `apps/web/src/components/sessions/SessionFormModalWide.tsx`, `apps/web/src/services/sessions.ts`, a shared reason field component, its test. **M**
  - *Depends on:* 2.4.
- [ ] **Task 2.6: The repository manifest and the migration scan**
  - *Acceptance:*
    - `tests/historyCoverageManifest.ts` declares every repository method that writes `sessions` or `session_episodes` as `versions` or `exempt` (with a reason).
    - The test scans `repositories/prisma/*.ts` and fails on a write method missing from the manifest, or on an entry that no longer writes one.
    - A migration scan fails on `UPDATE`, `DELETE`, `DROP COLUMN`, `ALTER COLUMN … TYPE` or `TRUNCATE` on a versioned table. Every migration that exists before this PR is frozen; the allowlist starts empty.
  - *Verify:* both pass on today's files. An unlisted write method, and a fixture migration with `UPDATE sessions`, each make them fail (checked once, reverted).
  - *Files:* `tests/historyCoverageManifest.ts`, `tests/historyCoverage.test.ts`, `tests/historyMigrationScan.test.ts`. **S**
  - *Depends on:* 2.3.
- [ ] **Task 2.7: The invariant helper and the session fixtures**
  - *Acceptance:*
    - After each test, the projection of every session of the test's clinics equals its latest snapshot, and every session has a revision.
      - Mechanism: `createTestClinic` registers the clinic, and an `afterEach` in `tests/setup.ts` checks it. Check vitest's hook order first: an `afterAll` would run after the files' own cleanup and prove nothing.
    - `createSessionFixture` writes a session, its blocks and version 1. Every test that inserts sessions directly uses it.
  - *Verify:* the full suite is green. A repository write that skips `recordRevision` makes the helper fail (checked once, reverted).
  - *Files:* `tests/setup.ts`, `tests/helpers.ts`, the test files that insert sessions directly. **M** (mechanical)
  - *Depends on:* 2.3.
- [ ] **Task 2.8: Docs, rehearsal and PR**
  - *Acceptance:*
    - `CLAUDE.md`:
      - under *Acceso a datos*, versioning in the write's transaction and the manifest rule;
      - `session_revisions` among the append-only tables;
      - the new helpers.
    - `docs/infra.md`: the revisions table in the wipe and restore procedures.
    - The spec: the rollout line for `reason` and the test cleanup, as decided here.
    - The migration is rehearsed on a copy of `production`.
    - Full local suites, then a PR against `dev`. After the merge: `migrate deploy` on `development`.
  - *Files:* `CLAUDE.md`, `docs/infra.md`, `docs/specs/SPEC-clinical-revisions.md`. **S**

### Checkpoint 2

- [ ] Full suites and `npm run check` are green.
- [ ] By hand (skill `verify`):
  - the same session edited in two tabs gives a `409` in the second;
  - a save with no change leaves no audit row;
  - removing a block shows in the next revision.

  Ask me to review before step 3: the pattern set here is copied five times.

### Step 3: The other five aggregates (PR 3)

One migration adds the five tables, grown task by task. Each task is one aggregate end to end:
- its table, triggers, guards and scans;
- its snapshot schema and projection coverage;
- its write path, `expectedVersion` and `reason`;
- its form;
- its fixtures and manifest entries.

The verification is the spec's per-aggregate list: v1 on creation, N+1 on an edit, nothing on a no-op, `409` when stale, and concurrent edits never lost.

- [ ] **Task 3.1: Episodes, and the discharge as a multi-aggregate action**
  - *Acceptance:*
    - `episode_revisions`, versioned on create and update.
    - A discharge locks patient, then session, then episodes by id, and writes one session revision and one revision per closed episode, all under the one `DISCHARGE_RECORDED` row.
    - `EPISODE_UPDATED` gains `reason`; `EPISODE_CLOSED` and `EPISODE_REOPENED` take none (spec §4).
    - The episode transitions in `PatientDetailPage` (abandon, reopen) send `expectedVersion` and no reason.
  - *Verify:* `episodeRevisions.test.ts`, plus a discharge test (one audit row, two revisions, consecutive versions), plus a concurrent discharge and episode edit that does not deadlock.
  - *Files:* `schema.prisma` + migration, `prismaEpisodeRepository.ts`, `prismaSessionRepository.ts`, `routes/episodes.ts`, `clinicalSnapshots.ts`, `PatientDetailPage.tsx`, tests. **M**
- [ ] **Task 3.2: Initial evaluation**
  - *Acceptance:*
    - `evaluation_revisions`, versioned on upsert. The first evaluation locks its episode, a later one its own row. `retractionMap` stays `z.unknown()` inside the snapshot.
    - The evaluation form sends its version and reason. It also updates the patient's occupation: that request carries the patient's version and the same reason.
  - *Verify:* `evaluationRevisions.test.ts`; `evaluationCrud`; the web test of the evaluation form.
  - *Files:* migration, `prismaEvaluationRepository.ts`, `routes/evaluations.ts`, `clinicalSnapshots.ts`, `PatientDetailPage.tsx`, tests. **M**
  - *Depends on:* 3.3, for the patient's version.
- [ ] **Task 3.3: Patient**
  - *Acceptance:*
    - `patient_revisions` versions identification and clinical context only (spec §1). `phone` and the coverage columns are in the exclusion list with their reason.
    - A change only to those writes the audit row with its `changedFields`, and no version.
    - The soft delete stays a `DELETE` and writes an event version, with no reason. Whether it becomes an annulment needs analysis later (spec §8).
    - `PatientFormDialog` sends version and reason.
  - *Verify:* `patientRevisions.test.ts`, including "a phone change writes no version", plus `patientsCrud`, `unSoloVacio` and the form's web test.
  - *Files:* migration, `prismaPatientRepository.ts`, `routes/patients.ts`, `clinicalSnapshots.ts`, `PatientFormDialog.tsx`, tests. **M**
- [ ] **Task 3.4: Informed consent**
  - *Acceptance:*
    - `consent_revisions`. Sign, sign again and revoke each write a version. The first signature locks the patient.
    - No reason: signing and revoking are facts, not corrections (spec §4).
  - *Verify:* `consentRevisions.test.ts`; `consentPolicy`.
  - *Files:* migration, `prismaConsentRepository.ts`, `routes/consent.ts`, `clinicalSnapshots.ts`, `ConsentTab.tsx`, tests. **S**
- [ ] **Task 3.5: Patient events**
  - *Acceptance:*
    - `patient_event_revisions`, versioned on create and update. Delete writes an event version until step 5.
    - `PatientHistoryCard` sends version and reason on an edit.
  - *Verify:* `patientEventRevisions.test.ts`; `patientEvents`; the card's web test.
  - *Files:* migration, `prismaPatientEventRepository.ts`, `routes/patientEvents.ts`, `clinicalSnapshots.ts`, `PatientHistoryCard.tsx`, tests. **M**
- [ ] **Task 3.6: Docs, rehearsal and PR**
  - *Acceptance:*
    - `CLAUDE.md` and `docs/infra.md` list the five tables.
    - The migration is rehearsed on a copy of `production`.
    - Full local suites, then a PR against `dev`. After the merge: `migrate deploy` on `development`.
  - *Files:* `CLAUDE.md`, `docs/infra.md`. **XS**

### Checkpoint 3

- [ ] The manifest, the projection coverage and the invariant cover all six aggregates. Full suites green.
- [ ] By hand: one edit of each aggregate writes one version, and a discharge writes two under one audit row.

### Step 4: Reading (PR 4)

- [ ] **Task 4.1: Revision routes**
  - *Acceptance:*
    - Six aggregates, two routes each:
      - `GET /api/patients/:patientId/<entity>/:id/revisions`: version, action, reason and author (the user's name, or none for `SYSTEM`), from the audit row;
      - `GET …/revisions/:version`: one snapshot with its note.
    - The repository filters by `(tenant, patient_id, aggregate_id)` in the `where`, and requires the patient to exist and not be deleted.
    - `:version` is validated (positive integer, else `404`) and registered in `idParamCoverage`.
    - The list-minimization probe seeds markers in `snapshot` and `reason_note`. No global route returns either.
  - *Verify:* `tests/revisionRoutes.test.ts`:
    - patient B's session through patient A's path answers `404`, and so does another clinic's;
    - a malformed id answers `404`;
    - a deleted patient answers `404`.

    Plus `listMinimization` and `idParamCoverage`.
  - *Files:* a new `revisionRepository.ts` port and Prisma implementation, the barrel, a new `routes/revisions.ts` (or one router per entity file), `app.ts`, `tests/listMinimization.test.ts`, `tests/listScopeManifest.ts`, the new test. **M**
- [ ] **Task 4.2: The history view, on sessions**
  - *Acceptance:*
    - Each session in the record has "Ver historial". It lists the versions ("Versión N · acción · motivo · autor · fecha") and shows the selected one read-only, from its snapshot, with the fields its audit row lists as changed marked.
    - All copy is in Spanish.
  - *Verify:* a web test of the history dialog: it lists, selects, and shows a removed block in the old version.
  - *Files:* `apps/web/src/services/revisions.ts`, `apps/web/src/components/patients/RevisionHistoryDialog.tsx` (new), the session entry in the record, its test. **M**
  - *Depends on:* 4.1.
- [ ] **Task 4.3: The history view on the other five, and PR**
  - *Acceptance:*
    - "Ver historial" on the episode, the evaluation, the patient's data, the consent and each patient event, each with its own snapshot renderer.
    - Full suites, then a PR against `dev`.
  - *Verify:* each renderer's web test; by hand through the skill `verify`.
  - *Files:* the five entry points in `PatientDetailPage.tsx`, `PatientHistoryCard.tsx`, `ConsentTab.tsx`, renderers, tests. **M**
  - *Depends on:* 4.2.

### Checkpoint 4

- [ ] From the record alone, any past version of any aggregate can be read with its author, time and reason.

### Step 5: Annulment (PR 5)

- [ ] **Task 5.1: Annul as an action (API)**
  - *Acceptance:*
    - `POST /api/patients/:patientId/sessions/:sessionId/annul` and `…/events/:eventId/annul`, with `{ reason, reasonNote? }`.
    - New actions `SESSION_ANNULLED` and `PATIENT_EVENT_ANNULLED`, each with `reason` (migration for the enum). `SESSION_DELETED` and `PATIENT_EVENT_DELETED` are marked `deprecated`.
    - Each annulment writes a final version. The paid-session rule (`409`) and the release of the appointment are kept.
    - The two `DELETE` routes are removed, and the manifest updated.
    - The record's lists (`listByPatient` of sessions and events) return annulled entries with `annulledAt` (from `deletedAt`). Every other reader keeps filtering them out: global lists, metrics, alerts, the episode's last activity, the pain chart.
    - No restore route: one is added later (spec §8).
  - *Verify:* `tests/annulment.test.ts`:
    - annul writes the action, the reason and the version;
    - no reason answers `400`;
    - a paid session answers `409` and writes nothing;
    - an annulled entry cannot be edited (`404`);
    - global lists and metrics exclude it.

    Plus `sessionSoftDelete` rewritten, `auditCoverage` and `dashboardStats`.
  - *Files:* `schema.prisma` + migration, `auditActions.ts`, `prismaSessionRepository.ts`, `prismaPatientEventRepository.ts`, `routes/sessions.ts`, `routes/patientEvents.ts`, `tests/auditCoverageManifest.ts`, tests. **M**
- [ ] **Task 5.2: Annul in the record (web), and PR**
  - *Acceptance:*
    - "Anular" replaces "Eliminar" on sessions and events, with a dialog for the reason ("Error de confección" preselected) and the note.
    - Annulled entries show struck through with an "Anulada" badge, and their history shows the annulment.
    - The migration is rehearsed on a copy of `production`.
    - Full suites, then a PR against `dev`.
  - *Verify:* web tests of the dialog and of the struck-through entry.
  - *Files:* `SessionFormModalWide.tsx`, `PatientHistoryCard.tsx`, `services/sessions.ts`, `services/patientEvents.ts`, the record's session list, tests. **M**
  - *Depends on:* 5.1.

### Checkpoint 5

- [ ] No clinical entry can be deleted from the app any more, only annulled with a reason; every annulment is a version.

### Step 6: Baseline (PR 6)

- [ ] **Task 6.1: System audit rows and the baseline script**
  - *Acceptance:*
    - `recordSystemAudit(tx, tenantId, entry)`: `actor_type = SYSTEM`, no user, no session.
    - New action `HISTORY_BASELINE` (entity `PATIENT`, migration for the enum).
    - `npm run history:baseline -w apps/api`:
      - one `SYSTEM` audit row per patient, owning version 1 of each of that patient's aggregates that has no revision (the patient included);
      - a dry run by default, which prints counts only; `--apply` writes;
      - a second run writes nothing.
    - The seed calls the same function at its end, so a seeded database is versioned.
  - *Verify:* `tests/historyBaseline.test.ts`: a clinic with unversioned rows gets exactly one v1 each, under one audit row per patient; a second run writes nothing; an aggregate that already had revisions is untouched.
  - *Files:* `repositories/prisma/recordAudit.ts` (or a sibling), `auditActions.ts`, `schema.prisma` + migration, `scripts/history-baseline.ts`, `apps/api/package.json`, `prisma/seed.ts`, the test. **M**
- [ ] **Task 6.2: PR, and the runs**
  - *Acceptance:*
    - Full suites, then a PR against `dev`.
    - After the merge, the script runs on `development` and `ci`, and on `staging` with your permission:
      - a dry run first, its counts in the PR;
      - then `--apply`;
      - a query through the MCP then shows no aggregate without a revision.
    - `CLAUDE.md` gets the script. `audit-map.md` marks `clinical-revisions` as implemented.
  - *Files:* `CLAUDE.md`, `docs/specs/audit-map.md`. **XS**
  - *Depends on:* 6.1.

### Checkpoint 6: complete

- [ ] The spec's success criteria are met.
- [ ] Every environment except `production` (wiped at the relaunch) has a revision for every aggregate.
- [ ] The relaunch (#238) can go ahead.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The move to a new Neon project | High: new URLs on Render, CI, the backups repository and local; PITR history starts over; a restore that silently drops rows | The restore is rehearsed and counted table by table (0.3, 0.4); `production` goes last; the old project is kept until the backup workflow runs against the new one |
| Writes made during the production move | High: rows of the trial lost | The `Ficha` service stays suspended from the dump to the switch; counts are compared table by table before resuming it (0.5) |
| `pg_get_functiondef` prints differently on 18 | High: `audit-guards.sql` fails in the Render build and at startup | Task 0.2 measures it on the container before any branch moves; both hash sets accepted during the transition |
| The `postgres:18` image changed its data directory | Medium: the test container does not start, or leaves its data off tmpfs | The tmpfs moves to `/var/lib/postgresql` (Task 0.2) |
| The comparison sees a change where there is none (date serialization, block order, JSON key order) | High: empty versions on every save, and the no-op promise broken | One mapping builds both the projection and the snapshot; `canonical()` from `changedFields.ts` compares; a no-op test per aggregate, and one after a schema bump |
| A discharge deadlocks with a concurrent episode edit | Medium: a `500` on a save | One lock order (patient, session, episodes by id) everywhere; a concurrency test in Task 3.1 |
| Fixtures that insert clinical rows directly (115 writes in 29 files) fail the invariant | Medium: mechanical work spread over steps 2 and 3 | Fixture helpers per aggregate; the invariant checks an aggregate only from its step |
| Test cleanup hits `RESTRICT` on revisions | Medium: flaky cleanup failures | `deleteAuditRows` deletes revisions first; Task 2.1 runs the full suite to find the tests that delete in the wrong order |
| A snapshot or a reason note leaks into a global list, a log or an alert | High: clinical text outside the record | The list-minimization probe seeds markers in both (Task 4.1); the log test (Task 2.3); `reason_note` is never in an audit row |
| Annulled entries come back into the readers of `listByPatient` | Medium: metrics or the pain chart count an annulled session | Task 5.1 lists every reader and tests the ones that must filter |
| Seven sequential PRs before the relaunch | Medium: the relaunch waits on all of them | Step 0 runs in parallel with steps 1 and 2; step 4 depends only on step 3 |

## Open Questions

Settled on 2026-11-01, now in the spec:
- no reason on state transitions, with the episode's own transition actions (*Decided Questions* 5);
- deleting a patient stays a `DELETE` with no reason, pending a later analysis (*Decided Questions* 6);
- no restore route in this module; one is added later (*Decided Questions* 7);
- Postgres 18 is a new Neon project, and `production` moves to it by dump in step 0, before the relaunch (*Decided Questions* 4).

None open.

## Out of Scope

- Stage 2, `clinical-revisions-enforcement` (it depends on #206).
- Moving a record to another patient; retention and data-subject rights (spec *Out of scope*).
- Whether deleting a patient becomes an annulment with a reason: it needs analysis later (spec §8).
- A restore route for sessions, patient events and patients: added later (spec §8).
- `HISTORY_MIGRATED`: declared by the first data migration after the relaunch that touches clinical content, not here.

## Decisions during implementation

### Step 0

- **The function hashes are the same on 18** (2026-11-01, Task 0.2). `pg_get_functiondef` prints the five audit functions on 18.6 exactly as on 16, so `audit-guards.sql` is unchanged and there is no second hash set to drop later.
- **A delete refused by an `ON DELETE RESTRICT` key is SQLSTATE `23001` on 18, not `23503`** (Task 0.2). Prisma 5.22 maps only `23503` to `P2003`, so on 18 the error arrives as `PrismaClientUnknownRequestError`. The guarantee holds and the app answers `500` as before: nothing in `src` catches `P2003`. A `NO ACTION` key and an insert still give `23503`. Three tests asserted `P2003` on such a delete; they now call `expectRestrictedDelete` (`tests/helpers.ts`), which accepts both until every Neon branch is on 18. The follow-up then drops the `P2003` case, in place of the hash set.
- **The 18 container was tested beside the shared one** (Task 0.2). Every worktree uses the compose project `ficha` on port 5433, and step 1 ran on it in parallel, still on 16. The 18 runs used another project on port 5434 (`docs/infra.md#local-test-database`); `npm test` on `ficha` itself switches to 18 when a worktree merges this PR.
- **The backups repository needs `pg_dump` 18 before `production` moves** (Task 0.5). Its `backup.yml` installs `postgresql-client-16` and checks the dump on `postgres:16`; `pg_dump` 16 refuses a server on 18. `pg_dump` 18 dumps the old 16 server too, so that change can land before the window, but its check moves to `postgres:18` in the same change: an 18 dump sets `transaction_timeout`, which 16 rejects. That change is candiath/ficha-backups#3; its README's restore also moved to 18 and to the four audit tables. It also ended a gap nobody had seen: `ubuntu-latest` moved to 26.04 on 2026-10-29, whose default `pg_dump` is 18 whatever client the workflow installs, so every scheduled run from then to 2026-11-03 failed its check on `postgres:16` and saved no dump. The manual run of 2026-11-04 (`pg_dump` 18.6, check on `postgres:18`) saved the first one since 2026-10-28.
- **`production` moves from the backups repository, not from a laptop** (Task 0.5, 2026-11-04). The production credential lives only there, and the old plan would have brought it and the trial's dump to this machine. candiath/ficha-backups#5 adds `move-to-18.yml`, in the shape of `wipe.yml`: a `rehearsal` target restores into a container on the runner and only reads production; `production` restores into the new project with the secret `PROD18_DATABASE_URL`, and refuses to run while the `Ficha` service answers. The workflow is deleted once `production` is on 18.
- **The new project is `ficha-pg18`** (Task 0.1), in the old project's region with its compute (0.25–2 CU) and history (6 h). The free plan does not let the maintenance window be chosen: Neon set Sunday 05:00–06:00 UTC. It is renamed `ficha` once the old project is deleted, so `CLAUDE.md` keeps naming it.
- **Every branch of a new project starts with the root's password** (Task 0.1). Branches inherit the role and its password, so the laptop's `development` URL or the `CI_DATABASE_URL` secret would open `production` by swapping the endpoint. In the old project they differ.
- **The rehearsal** (Task 0.3, 2026-11-01). On `ci`: the 57 migrations applied from empty, `audit-guards.sql` passed, `no-audit-maintenance.sql` failed on the flag, and `npm run test:neon` passed through the pooler (803 tests, 11 min). The old `staging` (16.15), dumped by `pg_dump` 18.6 from the `postgres:18` image with the backups repository's flags, restored into `rehearsal-restore` with the procedure in `docs/infra.md`. The comparison was stronger than counts: per table, the row count and an md5 of its rows as text, ordered. All 22 tables matched, 189 rows, and the restored branch then passed what the Render build runs (`no-audit-maintenance.sql`, `migrate deploy`, `audit-guards.sql`).
- **The switch of `staging`** (Task 0.4, 2026-11-02). `staging` (22 tables, 189 rows) and `development` (23, 210, its flag included) restored identical, and the old `staging` did not change between the dump and the switch. Saving env vars on Render redeploys without building, so `migrate:prod` does not run: a **Manual Deploy → Deploy latest commit** is what produces the build log. The first save pointed `ficha-staging` at `development`; the startup check failed on the flag and the staging bot sent `AUDIT_MAINTENANCE_FLAG_PRESENT` within seconds, which is the check doing its job. The deploy after the fix: build log with both checks and no pending migrations on the new `staging`, and both startup checks passing.
- **The switch of `ci`** (Task 0.4, 2026-11-02). The `CI_DATABASE_URL` secret was checked by a manual run of `test.yml` on this branch: migrations and `test:neon` passed on the new `ci`. Since then a release PR or manual run from a branch without `expectRestrictedDelete` fails three tests there, so none runs from one.

### Step 1

- **No `ALLOWED` entry in `auditMigrationScan.test.ts`.** The migration touches the audit tables only with `ADD VALUE` on their enums and a `CREATE UNIQUE INDEX` on `audit_logs`, and the scan flags neither: it looks for statements that could rewrite or unprotect audit content, and an added index can do neither. An entry with no violations would allow nothing.
- **`audit-guards.sql` pins the new key on `audit_logs`** by its exact definition, in the index check that already pinned `platform_audit_logs_action_entity_key`; the TEMP-copies test expects its absence to be reported. The keys on the other three tables are not pinned: the guards cover only the audit tables.
- **The episode's action is decided against the locked row, not the request's shape.** A status different from the stored one is a transition (`EPISODE_CLOSED` or `EPISODE_REOPENED`, its closing date part of it); anything else is a correction. So `{ status: 'DISCHARGED', closedAt }` on a discharged episode corrects the date (`EPISODE_UPDATED`, `["closedAt"]`), and a transition that sends the complaint unchanged is not refused. The repository returns what happened (`EpisodeChange`); the route turns it into the audit entry.
- **`AUDIT_EPISODE_FIELDS` is `mainComplaint` and `closedAt`.** The `PATCH` does not accept `openedAt`, so an opening date cannot be corrected yet; adding it to the list later is an append.
- **An empty `PATCH` of an episode answered `400`** "La fecha de cierre no puede ser anterior a la apertura del episodio": Prisma's `updateMany` with no fields counts 0, which the old code read as the date condition failing. It now answers `200` and writes nothing.
- **Reason labels are lowercase in the catalog**, like every list there, because sentences embed them; the form capitalizes ("Error de confección"). `LATE_INFORMATION` is "información recibida después", `CLARIFICATION` "aclaración", `OTHER` "otro motivo": labels, not codes, so they can still change.
- **The reason's request schema lives in `auditActions.ts`**: `revisionReasonFields`, which a correction's body schema spreads, and `revisionReasonSchema` for an annulment's body. No new runtime module. `reasonNote` repeats the single-empty rule of `optionalText` (the package cannot import the API's), with a 500-character limit like the appointment notes.
- **The record's activity timeline gets an `EPISODE` badge** ("Episodio"); without it, episode rows showed the neutral "Registro".
- **A discharge still closes its episodes under `DISCHARGE_RECORDED` alone**, with no `EPISODE_CLOSED` row: one action, one audit row (spec §4). Its episode revisions arrive in Task 3.1.
