---
name: review-pr
description: Review a Ficha PR before merge with the code reviewer and the security auditor in parallel, verify every finding against the code, fix the confirmed ones on the PR branch and report. Use when Nath types /review-pr <number> [--report-only], or asks for a PR to be reviewed "como venimos haciendo".
---

# Review a PR

`/review-pr <number>` reviews, fixes and pushes. `/review-pr <number> --report-only` stops after the report: nothing is fixed, committed or posted until Nath approves the findings.

This is the review #288 and #291 had. It replaces writing the brief by hand each time.

## 1. Set up

- `gh pr view <number> --json title,body,headRefName,baseRefName,files` gives the branch, the base (`dev`, or `main` for a release) and the files.
- Work on the PR's branch. In a worktree that does not have it, `git fetch origin <branch>` and `git switch <branch>`. Never force-push and never rewrite its history.
- If there is no `node_modules`, run `npm install` first. Then always run `npm run build -w packages/shared` and `npm run db:generate -w apps/api`: `npm install` does not regenerate the Prisma client.
- The diff under review is `git diff origin/<base>...HEAD`.

## 2. Read before reviewing

- `CLAUDE.md`: it holds the conventions the code is held to (section 4).
- The PR's description, and every spec or plan it links. For a clinical-revisions step, that means `docs/specs/SPEC-clinical-revisions.md` and the step in `docs/specs/PLAN-clinical-revisions.md`, including its "Decisions during implementation".
- The hand-over note in the shared notes folder, if the session that wrote the PR left one.

From the diff and the plan, write down the points that most need fresh eyes: lock order, transactions, a migration, a new route, a form that writes. Each reviewer gets that list.

## 3. Two reviewers, in parallel

Start both in one message with the Agent tool. Give each the PR number, the base, the diff command, the files from section 2 and your list of points.

- **`agent-skills:code-reviewer`**: the five axes (correctness, readability, architecture, security, performance), measured against the spec, the plan and section 4. It also judges the tests: whether each new test can actually fail when the behaviour it names breaks, and what is left untested.
- **`agent-skills:security-auditor`**: clinical data and its exposure. That covers:
  - tenant isolation and IDOR (another clinic's or another patient's id in a path or body);
  - clinical text in global lists, logs, error messages or audit params;
  - audit and revision integrity: a write path with no audit row or no version, or a rollback that swallows a real error;
  - auth sessions and tokens.

Ask each reviewer for findings ranked by severity. Each finding needs `file:line`, a concrete failure scenario (input or state → wrong result), and whether it belongs in this PR or existed before it.

## 4. What Ficha holds every change to

The reviewers check these. Anything the diff touches gets checked here too:

- **The database is touched only in `repositories/`.** Writes carry their condition in the `where`. Not found is `null`/`false`, never a throw.
- **Foreign keys are composite** `(tenant_id, …)`, plus `patient_id` where there is one, always `Restrict`.
- **Audited writes** record their audit row in the same transaction, as codes from `packages/shared/src/auditActions.ts`. Every write route is in `tests/auditCoverageManifest.ts`.
- **Versioned tables:**
  - every writing method is in `tests/historyCoverageManifest.ts`;
  - every column is in the snapshot or excluded with a reason;
  - a snapshot schema that was already written is never changed;
  - a no-op write writes nothing;
  - a stale `expectedVersion` gets a `409`.
- **Migrations:**
  - destructive changes go out in two releases;
  - no `UPDATE`/`DELETE`/type change on a versioned table without an allowlist entry;
  - DDL on the audit tables comes with `audit-guards.sql` and `auditMigrationScan` entries;
  - a migration Render runs at build must pass on a copy of `production`.
- **Every `GET` outside the record** is in `tests/listScopeManifest.ts`, and it returns no clinical text. Every `:param` is registered with `idParam`.
- **"Un solo vacío"**: `""` becomes `null`, and a missing field is left untouched. An edit form renders from the full record, never from a list item.
- **Data formats:**
  - money is integer cents;
  - the API never adjusts a date it was sent;
  - ids are UUIDs, validated before the query.
- **Language:** what users read is in Spanish; code, tests, commits and docs are in English.

## 5. Verify, then fix

- Check every finding against the code yourself before you keep it: read the lines, follow the call, and write or run a test where that settles it. Drop what does not hold, and say why in the report.
- **Fix in this PR** what the PR introduced or what breaks what it promises. Use small commits with a conventional prefix, in English, and end each message with the attribution line. Add a test that fails without each fix.
- **Leave for Nath** what existed before the PR and is not made worse by it, and anything that needs its own analysis. List these items. Do not open issues or PRs for them without asking.
- After the fixes, run all three checks:
  - `npm test`, which needs Docker. If Docker is down, ask Nath to start it. The test container is shared across worktrees, so a run that another session reset ("tenants does not exist", or no answer on :5433) is not a real failure: run it again.
  - `npm test -w apps/web`
  - `npm run check`

  Then push to the PR's branch.
- Open the app in the browser (skill `verify`) when a fix changes what a screen shows.

## 6. Report

In Spanish, opening with "En qué estamos: …":

- the findings by severity, each one fixed (with its commit), rejected (with the reason) or left for Nath (with where it belongs);
- the three checks and their counts;
- what was not verified, such as the browser.

## Never

- Merge.
- Push to `dev` or `main`.
- Force-push.
- Touch `production`.
- Create or delete a Neon branch without Nath's OK.
