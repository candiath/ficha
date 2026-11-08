# Spec: clinical-revisions

Module of the [audit capability map](audit-map.md) (issue #186). **Status: approved 2026-11-01**, after three adversarial review cycles (two general reviewers and one security reviewer, each with fresh context and read access to the repo; a cross-model reviewer without repo access found nothing new).

This module is the first of two stages. Stage 2, `clinical-revisions-enforcement`, is sketched at the end and gets its own spec.

## Objective

Today a `PATCH` on a clinical record overwrites the row, and the audit row records only the names of the changed fields. Some edits physically delete rows (a session's blocks in `session_episodes`). The previous clinical content is lost on every edit.

Ley 26.529 asks for a computerized clinical record that guarantees integrity, authenticity, inalterability, perdurability and recoverability, kept at least ten years. After this module:

- **Every version of a clinical record is recoverable**, from its creation on, with who wrote it, when, and why it changed.
- **A version is a snapshot of the whole aggregate** (a session with all its blocks), so removing a block, or any change spread over several rows, is captured.
- **The current tables do not change.** The app keeps reading and writing them as today.
- **No clinical content enters the audit log**, which keeps holding codes only.
- **Two concurrent edits no longer overwrite each other silently**: the second one gets a `409`.

Real clinical data starts at the relaunch (#238), so this module ships before it. History cannot be added retroactively: every edit made before it is lost.

### What this module does not protect against

- **Writes that skip the repositories**: Prisma Studio, `psql`, a migration, or a repository method that forgets to version. Stage 1 detects the last one in tests (§9); preventing all of them is stage 2.
- **The owner role.** The app connects as the role that owns the tables, so inside one transaction it can disable a trigger, rewrite a revision and re-enable it without leaving a trace. This is #206, and stage 2 depends on it.
- **Impersonation through a password reset link.** An ADMIN can generate a link for a therapist, use it herself and write versions in the therapist's name: the ADMIN's generation and the use of a link are not audited yet (#186). Accepted until the mailer replaces hand-delivered links (decided 2026-11-01).
- **A record entered on the wrong patient.** Annulling it keeps its content readable in that patient's history. Moving it is out of scope (see *Out of scope*).

## Decisions

Each one survived the review cycles; the reason is kept so it is not reopened by accident.

1. **Versioning lives in the repositories, not in a database trigger that writes the history.** A trigger sees only the old and the new row: it cannot learn the editor (a session variable can leak through Neon's pooler), it does not see a block deleted by another statement, and it cannot group the session and its blocks into one version. The repository already has the `ctx`, the transaction and the audit row.
2. **A revision stores the NEW state, creation included** (the model of Hibernate Envers and django-simple-history, not PaperTrail's previous state). Each row reads as "version N, with this content", the history is self-contained, and the invariant *current row = latest snapshot* makes a forgotten write path detectable (§9). The cost is one extra copy of the current state: estimated at ~4 MB per therapist per year with typical notes.
3. **One revisions table per aggregate**, not one polymorphic table: a polymorphic `entity_id` cannot carry a foreign key, and every row of this schema points at its patient's rows with composite keys.
4. **Who, when and what live only in `audit_logs`.** A revision points at its audit row; it does not repeat author or time. An audit row may own several revisions (a discharge closes episodes in the same action).
5. **The snapshot is jsonb with a Zod schema in `packages/shared`**, versioned by `schema_version` (the project convention for JSON columns). Dropping or renaming a column does not break old versions.
6. **Decide "changed" by comparing with the latest snapshot, before writing.** Comparing with what the editor loaded lets a stale form slip through unversioned; writing first and comparing after turns every no-op save into a row update with no version.

## Tech Stack, Commands

Express 5, Prisma 5, **Postgres 18** on Neon (pooled runtime URL, direct URL for migrations), decided 2026-10-31: native `uuidv7()` for ids written in SQL (data migrations, the baseline). The move from 16 is rollout step 0, to a new Neon project (decided 2026-11-01). No new dependencies. Commands: `npm test`, `npm test -w apps/web`, `npm run check`, `npm run db:migrate`. Triggers and functions are hand-written SQL in the migration, as in `20261010191055_audit_rows_enforced`.

## Design

### 1. Scope: versioned aggregates

| Aggregate | Current tables | Revisions table |
|---|---|---|
| Patient | `patients` | `patient_revisions` |
| Session | `sessions` + its `session_episodes` | `session_revisions` |
| Episode | `clinical_episodes` | `episode_revisions` |
| Initial evaluation | `initial_evaluations` | `evaluation_revisions` |
| Informed consent | `informed_consents` | `consent_revisions` |
| Patient event | `patient_events` | `patient_event_revisions` |

**Patient fields.** Versioned: identification (`firstName`, `lastName`, `birthDate`, `sex`, and the document fields when they land) and clinical context (`occupation`, `referringDoctor`). Not versioned: contact (`phone`) and coverage (`insuranceName`, `insuranceNumber`, `insurancePlan`); their changes are still recorded as `changedFields` in the audit row, and still take a version, of unchanged content, so `expectedVersion` sees every write (decided in step 3's review). Versioning coverage later is a schema bump (§3). The patient's soft delete and restore are versions (events), not a field of the snapshot.

**Not versioned:** payments (billing, not clinical record; if the coverage a session was billed under matters, the payment stores it), appointments, clinical alerts.

### 2. Revisions tables

Session example; the others follow the same shape with their own parent key.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | UUIDv7 generated by the app, like every other PK |
| `tenant_id`, `patient_id`, `session_id` | `uuid` | Composite FK `(tenant_id, patient_id, session_id) → sessions (tenant_id, patient_id, id)`, `RESTRICT` |
| `version` | `int` | `UNIQUE (session_id, version)`, `CHECK (version >= 1)` |
| `audit_log_id` | `uuid` | Composite FK `(tenant_id, patient_id, audit_log_id) → audit_logs (tenant_id, patient_id, id)`, `RESTRICT`, `NOT NULL`, not unique |
| `snapshot` | `jsonb` | §3 |
| `schema_version` | `int` | §3 |
| `reason_note` | `text` | Optional, normalized with `optionalText` (single-empty rule). Clinical content |

Prerequisite constraints, in their own migration: `@@unique([tenantId, patientId, id])` on `audit_logs`, `initial_evaluations`, `informed_consents` and `patient_events`. The `audit_logs` change is DDL on an audit table: an entry in `tests/auditMigrationScan.test.ts` and new expected values in `audit-guards.sql`.

Every revisions model is classified in `TENANT_SCOPED_MODELS` (`tests/tenantScopeCoverage.test.ts`).

### 3. Snapshot

- **Canonical projection.** Each aggregate has an explicit list of the fields its snapshot holds, and an explicit list of excluded columns (`id`, `tenantId`, `patientId`, `createdAt`, `updatedAt`, `deletedAt`). The session snapshot holds the attending therapist (`userId`), the type, the date, the observations and the blocks ordered by `episodeId`; the evaluation, `evaluatedAt`; the episode, its complaint, status and dates; the consent, `signedAt` and `revokedAt`. The current `AUDIT_*_FIELDS` lists are not the base: they miss several of these.
- **Coverage test** (`tests/historyProjectionCoverage.test.ts`): every column of a versioned table is either in its projection or in its exclusion list. A new column fails CI until someone decides.
- **Zod schema** per aggregate and per `schema_version` in `packages/shared`, strict (`strictObject`). The evaluation's `retractionMap` stays `z.unknown()` inside the snapshot, as in its column, until its shape is defined. Every past schema version is kept, with a fixture test proving it still parses.
- **Adding a field later** (e.g. coverage): bump `schema_version`; the comparison in §5 compares only the fields both versions know, so the first save after the bump does not create an empty version.

### 4. Link to the audit log

- `recordAudit` returns the id of the row it inserted.
- `AuditEntity` gains `EPISODE`, and the catalog gains episode actions: `EPISODE_OPENED`; `EPISODE_CLOSED`, with its status (`DISCHARGED`, `ABANDONED`); `EPISODE_REOPENED`; and `EPISODE_UPDATED`, only for corrections of the complaint or the dates. A request that changes the status and corrects data at once is refused (`400`): one write, one fact. Episode writes move into a transaction with their audit row: this is the episode part of `clinical-audit-coverage`, a prerequisite.
- Corrections and annulments gain a `reason` parameter with codes: `DATA_ENTRY_ERROR`, `LATE_INFORMATION`, `CLARIFICATION`, `OTHER`. **Required on every correction (`*_UPDATED`) and every annulment** of a versioned aggregate (decided 2026-11-01); the UI preselects none (decided 2026-11-08, replacing the preselected `DATA_ENTRY_ERROR` of 2026-11-01): saving without one marks the field and moves the focus to it, so every reason recorded was chosen by someone. **State transitions take none** (decided 2026-11-01): closing or reopening an episode, and signing or revoking a consent, are facts, not corrections, so "Error de confección" has no meaning there. New codes only: existing codes are never renamed or reused.
- A multi-aggregate action (`DISCHARGE_RECORDED`, which closes episodes) owns one session revision and one revision per closed episode.

### 5. Write path

`recordRevision(tx, ctx, …)` lives next to `recordAudit`. In the same transaction as the clinical write:

1. **Lock** the aggregate's root row (`SELECT … FOR UPDATE`). For a creation that has no row yet (first evaluation of an episode, first consent), lock the parent row (episode, patient). A multi-aggregate write (the discharge) locks what it writes, its episodes by id, before anything else, and not the patient: an episode edit holds the episode and its audit row then takes a share lock on the patient, so holding the patient would deadlock with it (decided in step 3). `LOCKABLE` in `changedFields.ts` gains `clinical_episodes`, `informed_consents` and `patient_events`.
2. **Read the latest revision.** If the request carries `expectedVersion` and it is not the latest, return `{ ok: false, reason: 'stale' }`; the route answers `409` ("Otra persona editó este registro. Recargá para ver los cambios."). Edit forms send the version they loaded; record DTOs carry `version`.
3. **Build the new state's projection** from the current state plus the input, and compare it with the latest snapshot. If equal, **write nothing**: no update, no audit row, no revision. A save that changes something rewrites only the blocks that changed; the session's forced `updatedAt` stays for it, because an edit of a block alone writes no column of the session.
4. **Write** the clinical rows, then the audit row, then one revision per changed aggregate with `version = latest + 1`.

Creation writes version 1. A revisions insert that fails rolls the whole action back.

### 6. Append-only

Revisions tables reuse the audit functions: `*_append_only` (`BEFORE UPDATE OR DELETE`, `audit_rows_are_append_only`) and `*_no_truncate` (`BEFORE TRUNCATE`). Deleting is possible only under the maintenance switch, which only `development` and `ci` allow. The tables, triggers and FKs are added to `audit-guards.sql` and to the migration scan test (`AUDIT_NAMES`).

### 7. Reading

- `GET /api/patients/:patientId/<entity>/:id/revisions`: the list of versions (version, action, reason, author, time, from the audit row), and `GET …/revisions/:version` for one snapshot.
- The repository filters by `(tenant, patient_id, aggregate_id)` in the `where`, and requires the patient to exist and not be deleted. A test asks for patient B's session through patient A's path and gets `404`.
- Revision routes are inside the record: classified in `idParamCoverage`; no global route returns `snapshot` or `reason_note`, and the list-minimization probe seeds markers in both.
- **Who may read past versions:** every user of the clinic, as with the current record (decided 2026-11-01). Finer rules come later, with roles and `record-access-log`.

### 8. Annulment

Sessions and patient events have a soft delete today. It becomes `POST …/annul` with a required reason code and optional note in the body (the web client's `DELETE` sends no body), writes a final version, and the record shows the entry struck through; lists and metrics keep filtering it. **No restore route exists today**, for sessions, patient events or patients, and this module adds none: one will be added later (decided 2026-11-01), and a restore will write another version. Episodes and evaluations have no delete today and get none in this module. Consent keeps its sign/revoke actions, each one a version.

**Deleting a patient stays a `DELETE`**, with an event version and no reason (decided 2026-11-01). **It needs analysis later**: it hides the whole record, so it may deserve to become an annulment with a reason, like sessions and events.

### 9. Detecting a write that skipped versioning

- **Repository manifest** (`tests/historyCoverageManifest.ts`, like `auditCoverageManifest`): every repository method that writes a versioned table declares that it versions, or is exempt with a reason.
- **Invariant helper** in the API suite: after each test, for every aggregate the test wrote, the projection of the current state equals the latest snapshot. Fixtures that insert rows directly use a helper that also writes version 1, so they pass.
- **Migration scan**: a migration with `UPDATE`, `DELETE`, `DROP COLUMN`, `ALTER COLUMN … TYPE` or `TRUNCATE` on a versioned table fails unless it is allowlisted with a reason. After the relaunch, a data migration on clinical content writes `SYSTEM` audit rows and revisions (a new action, `HISTORY_MIGRATED`).
- No periodic production scan: it was rejected (cross-tenant reads without `forTenant`, a full scan on every Render cold start, an alert that cannot name the record).

### 10. Existing rows

`staging`, `development` and `ci` hold rows created before this module. A one-off script (`npm run history:baseline -w apps/api`, TypeScript so ids are UUIDv7) writes version 1 for every aggregate without one, under a `SYSTEM` audit row (`HISTORY_BASELINE`). Production is wiped at the relaunch and needs none.

### 11. Logs

Revision code paths and triggers never put row values in an error message. A failed revision insert is logged as code, table and id. A test forces a failure and checks the log for marker text. Postgres puts the failing row in the detail of a constraint error and Prisma's `error` log prints it, so that log is off outside development; errors are still thrown, and logged by the error handler.

## Testing Strategy

Vitest + supertest against the throwaway Postgres (`npm test`), repository tests with `createTestContext`. Per aggregate: creation writes version 1; an edit writes N+1 with the right snapshot, author and reason; a no-op save writes nothing and answers `200`; a stale `expectedVersion` answers `409` and writes nothing; two concurrent edits produce consecutive versions or a `409`, never a lost write. Sessions: removing a block is visible in the next snapshot; a discharge writes the session and episode revisions under one audit row. Plus: append-only and truncate rejection, the IDOR test, the projection coverage test, the repository manifest, the invariant helper, the migration scan, old schema fixtures, and the log test.

**Test cleanup.** Revisions reference clinical rows and audit rows with `RESTRICT`, so cleanup deletes revisions first: `deleteAuditRows` does it for the clinics it is given, in its maintenance transaction, and test files that delete clinical rows after it need no change. `deleteRevisions(table, ids)` is for deleting one aggregate in the middle of a file.

## Rollout

Each step is a PR against `dev`, in order:

0. **Postgres 18**: a new Neon project, with its branches moved by dump and restore (`production` included, before the relaunch), the test container in `docker-compose.yml`, CI, and `docs/infra.md`. Rehearsed on a throwaway branch first.
1. Prerequisites: composite unique keys, `recordAudit` returns its id, `LOCKABLE` additions, catalog changes (`EPISODE`, episode actions, the list of reason codes), episode writes in a transaction with audit.
2. `session_revisions` + `recordRevision` + the session write path, `expectedVersion`, the `reason` parameter of `SESSION_UPDATED`, no-op skip, test helpers and cleanup, coverage tests. Each later step attaches `reason` to the aggregates it versions: the catalog validates strictly, so a parameter is required from the commit that adds it.
3. The other five aggregates.
4. Reading routes and the history view in the record.
5. Annulment as an action with reason.
6. Baseline script, run on `staging`, `development` and `ci`.

All of it before the relaunch's wipe (#238).

## Boundaries

- **Always:** version in the same transaction as the write and its audit row; compare with the latest snapshot before writing; add every new column of a versioned table to its projection or exclusion list; keep clinical text out of audit rows, logs and global lists.
- **Ask first:** excluding a column from a projection; a new reason code; any migration that touches existing rows of a versioned table after the relaunch.
- **Never:** update or delete a revision outside maintenance; version by moving foreign keys; reuse or rename an audit code; put a snapshot value in an error message.

## Success Criteria

- Every write route that changes a versioned aggregate writes exactly one version per changed aggregate, linked to its audit row, and nothing on a no-op.
- From the revisions alone, the state of any aggregate at any version can be rebuilt, with author, time and reason.
- The coverage tests, the invariant helper and the migration scan fail on a forgotten field, a forgotten write path and an unlisted data migration.
- No clinical text in audit rows, logs, alerts or cross-patient responses (list-minimization probe extended).

## Later: `clinical-revisions-enforcement` (stage 2)

Depends on this module and on #206 (a runtime role that owns nothing; migrations under an owner role whose credential is not on Render). Sketch, to be specified:

- A deferred constraint trigger on every versioned table that, at commit, requires a revision of that aggregate and its audit row in the same transaction (`xact_id xid8` stamped by a `BEFORE INSERT` trigger on revisions and on `audit_logs`), for the same entity, with contiguous versions. Hard deletes and inserts without a revision only under maintenance.
- One full comparison when it is switched on, to find any write that skipped versioning during stage 1.
- The backup restore procedure (`docs/infra.md`) updated and rehearsed in the same PR.
- An external anchor: the daily backup records per-table row counts and hashes in the private repository.

## Out of scope

- **Moving a record to the right patient.** Path if needed: annul with `WRONG_PATIENT`, hide its content in that patient's history behind a restricted permission, then an assisted "reassign" action that copies it to the right patient keeping the original date and therapist.
- **Retention end and data-subject rights** (rectification, suppression under Ley 25.326 against the ten years of Ley 26.529): a legal question, as for the audit tables.

## Decided Questions

Settled 2026-10-31 and 2026-11-01:

1. **Reading past versions:** every user of the clinic for now (§7).
2. **Reasons:** always asked, none preselected (§4; until 2026-11-08, `DATA_ENTRY_ERROR` was).
3. **Reset-link impersonation:** accepted until the mailer (*What this module does not protect against*).
4. **Postgres 18:** now, as rollout step 0, in a new Neon project. Every branch moves by dump and restore, `production` included, before the relaunch rather than at its wipe (*Tech Stack*, *Rollout*).
5. **No reason on state transitions:** the episode's closing and reopening get their own actions; consent sign and revoke take no reason either (§4).
6. **Deleting a patient:** stays a `DELETE` with no reason, **pending a later analysis** of whether it becomes an annulment (§8).
7. **Restoring:** no route in this module; one will be added later (§8).
