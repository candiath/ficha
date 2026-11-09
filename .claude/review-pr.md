# Ficha's rules for reviewing a PR

This file is read by the `review-pr` skill before it reviews a Ficha PR. It holds what is specific to Ficha; the review process itself lives in the skill.

## Setup

- The base is `dev` for a feature PR and `main` for a release PR.
- Before any test, run `npm run build -w packages/shared` and `npm run db:generate -w apps/api`. `npm install` does not regenerate the Prisma client, and a stale client fails lint and the tests.
- `npm test` needs Docker. If it is down, ask Nath to start it.
- The test container is shared across worktrees. A run that another session reset ("tenants does not exist", or no answer on :5433) is not a real failure: run it again.

## Read

- `CLAUDE.md`.
- For a clinical-revisions step, `docs/specs/SPEC-clinical-revisions.md` and the step in `docs/specs/PLAN-clinical-revisions.md`, including its "Decisions during implementation".

## Security focus

This is clinical data. The auditor looks at:

- **Tenant and patient isolation**: another clinic's or another patient's id, in a path or a body.
- **Where clinical text ends up**: it must not reach global lists, logs, error messages or audit params.
- **Audit and revision integrity**: no write path without an audit row or a version, and no rollback that swallows a real error.
- **Auth sessions and password-reset tokens.**

## Checklist

The reviewers check every change against these, and anything the diff touches gets checked here too:

- **Data access**
  - The database is touched only in `repositories/`.
  - Writes carry their condition in the `where`.
  - Not found is `null`/`false`, never a throw.
- **Foreign keys** are composite: `(tenant_id, …)`, plus `patient_id` where there is one, always `Restrict`.
- **Audited writes**
  - The audit row is recorded in the same transaction as the write.
  - Its contents are codes from `packages/shared/src/auditActions.ts`.
  - Every write route is in `tests/auditCoverageManifest.ts`.
- **Versioned tables**
  - Every writing method is in `tests/historyCoverageManifest.ts`.
  - Every column is in the snapshot or excluded with a reason.
  - A snapshot schema that was already written is never changed.
  - A write that changes nothing writes nothing.
  - A stale `expectedVersion` gets a `409`.
- **Migrations**
  - Destructive changes go out in two releases.
  - No `UPDATE`, `DELETE` or type change on a versioned table without an allowlist entry.
  - DDL on the audit tables needs `audit-guards.sql` and `auditMigrationScan` entries.
  - A migration must pass on a copy of `production`.
- **Reads and ids**
  - Every `GET` outside the record is in `tests/listScopeManifest.ts` and returns no clinical text.
  - Every `:param` is registered with `idParam`.
- **One empty value**
  - `""` becomes `null`, and a field that is not sent is left as it is.
  - An edit form renders from the full record, never from a list item.
- **Values**
  - Money is integer cents.
  - The API never adjusts a date it was sent.
  - Ids are UUIDs, validated before the query.
- **Language**: what users read is in Spanish; code, tests, commits and docs are in English.

## Checks

Run all three before pushing:

- `npm test`
- `npm test -w apps/web`
- `npm run check`

## Report

In Spanish, opening with "En qué estamos: …".

## Limits

- Never touch `production`.
- Never create or delete a Neon branch without Nath's OK.
- Never push to `dev` or `main`.
