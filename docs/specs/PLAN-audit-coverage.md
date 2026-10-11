# PLAN: audit-coverage

Spec: [`SPEC-audit-coverage.md`](SPEC-audit-coverage.md). Map: [`audit-map.md`](audit-map.md).

## Tasks

1. **Manifest** — `apps/api/tests/auditCoverageManifest.ts`: types `AuditTable`, `DebtModule`, `AuditCoverage`, and `AUDIT_COVERAGE` with the 44 routes (21 audited/exempt, 23 debt). Acceptance: the file type-checks.
2. **Coverage test** — `apps/api/tests/auditCoverage.test.ts`: extract write routes from `app.ts` and `routes/*.ts`, with mount paths; assert the four rules in the spec. Acceptance: green on the current tree.
3. **Red check** — remove one debt entry and one audited entry by hand, confirm the test fails naming each key, restore. Acceptance: both failures seen, file restored (`git diff` shows only the new files).
4. **CLAUDE.md rule** — English section on the audit rule, pointing at the manifest. Acceptance: text references the test file.
5. **Full suite** — `npm test -w apps/api` and `npm run check` (lint). Acceptance: both pass.
6. **PR** — branch `feat/audit-coverage` from `dev`, PR against `dev`, auto-merge with merge commit once `test` passes.

## Out of scope for this PR

- Any route change, any migration, any database access.
- Closing debt entries (each module does it).
