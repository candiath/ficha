# SPEC: audit-coverage

Module of the capability map [`audit-map.md`](audit-map.md) (issue #186). Status: implemented. An adversarial review ran before implementation, and its findings are folded into *Test assertions* and *Limits*.

## Objective

Make it impossible to add a write route without deciding, in review, whether it leaves an audit row. Today the map lists 23 write routes without one; nothing stops a 24th.

A manifest classifies every write route (`POST`, `PUT`, `PATCH`, `DELETE`) of the API as one of:

- **audited**: writes a row to a named table (`audit_logs`, `platform_audit_logs`, `login_events`, or a table a later module creates);
- **exempt**: does not record an action, with the reason (e.g. the route writes nothing, or it only validates);
- **debt**: no audit row yet, with the module id of the spec that will close it (`clinic-audit`, `account-audit`, `clinical-audit-coverage`, `security-events`).

A test reads `apps/api/src/app.ts` and `apps/api/src/routes/*.ts`, extracts every write route with its full mount path, and compares the set against the manifest.

## Limits (stated, not checked)

- **Writes on GET are out of the manifest.** `GET /api/alerts` and `/stats` create alerts through `refreshAlerts`. They belong to `clinical-audit-coverage` (the engine's rows, no actor), which must add them to the map's debt when it starts.
- **`audited` means the route writes its row, not that the table is named correctly.** The test does not read `recordAudit` calls; each module's tests do.
- **Best-effort writes are `audited` too.** The successful login event is written fire-and-forget and errors are swallowed (`lib/loginGuard.ts`). `login_events` is listed as audited; `security-events` removes the gap.
- **Debt is compared with the map by hand** at each PR that closes debt. The test does not parse `audit-map.md`.
- **Exempt entries are reviewed in PR.** The test checks that a reason exists, not that it is a good one.
- **Keys use mount param names.** A rename of `:patientId` in `app.ts` fails the test on purpose; it changes no authorization.

## Non-goals

- It does not prove that an audited route writes its row. Each route's own tests check that (e.g. `auditTransactional.test.ts`). The manifest is an inventory.
- It does not change any route's behavior or database schema. No migration.
- It does not classify reads (`GET`). The map handles reads with `record-access-log`.
- It does not check the `auditTable` value against the code, only that it is a known table name.

## Design

### Manifest

`apps/api/tests/auditCoverageManifest.ts` exports `AUDIT_COVERAGE: Record<string, AuditCoverage>`, keyed by `METHOD fullPath`, e.g. `POST /api/patients/:patientId/episodes`.

```ts
type AuditCoverage =
  | { status: 'audited'; table: AuditTable }
  | { status: 'exempt'; reason: string }
  | { status: 'debt'; module: DebtModule };
```

The key uses the route's own param names. A rename in code fails the test, which is the intent.

### Extraction

- Route files: regex over the source for `.post|.put|.patch|.delete` calls, with an optional generic argument. The generic may contain parentheses-free `<...>` nesting (e.g. `router.post<Pick<Params, 'patientId'>>('/', ...)`). Route paths are the first string literal argument.
- Mount paths: from `app.ts`, `app.use('<prefix>', [middleware,] <xRouter>)`, mapped to the route file through its import (`import xRouter from './routes/<file>'`).
- Path join: `mount + route`, with `'/'` contributing nothing. Trailing slashes are dropped.
- `app.ts` itself is scanned for direct `app.<method>` calls with an empty mount prefix (none today).

### Test assertions

1. Sanity: the number of extracted write routes equals the number of `router.<write>(` / `app.<write>(` occurrences in the scanned files (a regex that went blind fails here, not silently). Calls are matched only on a `router` or `app` receiver, so `repo.delete(...)` is not a route.
2. Every extracted write route has a manifest entry (missing → fail, with the key listed).
3. Every manifest entry matches an extracted route (stale → fail, with the key listed).
4. Every `debt` entry names a module in the `DebtModule` union, and every `audited` entry names a table in the `AuditTable` union. The type checker enforces this, not vitest: `tsconfig.check.json` includes `tests/`, and `npm run check` runs it. Every `exempt` entry has a non-empty reason (vitest).
5. No two extracted routes share a key, and every route file with writes is mounted in `app.ts`.

Each module that closes debt deletes its entries; the type unions make a typo a compile error.

### Initial classification

Derived from `audit-map.md` "Where we stand" and the code as of 2026-10-11 (44 write routes).

- **audited (`audit_logs`)**: patients `POST`, `PATCH`, `DELETE`; sessions `POST`, `PATCH`, `DELETE`; evaluation `PUT`; consent `POST`, `DELETE`; scales `POST`; payments `POST`, `PATCH`.
- **audited (`platform_audit_logs`)**: all six `/api/platform/*` writes except the login and password change.
- **audited (`login_events`)**: `POST /api/auth/login`, `POST /api/platform/auth/login`. Partial: the success is fire-and-forget and throttled attempts are not recorded; `security-events` closes that.
- **exempt**: `POST /api/auth/password-reset/check` (validates a token, writes nothing).
- **debt**: the 23 routes listed in the map (users ×4 → `clinic-audit`; tenant `PATCH` → `clinic-audit`; own-account routes in `auth` and platform `change-password` → `account-audit`; episodes, appointments, alerts, packages, scale `DELETE` → `clinical-audit-coverage`; `POST /api/auth/password-reset` → `account-audit`).

Totals: 21 audited or exempt, 23 debt.

### Rule in CLAUDE.md

A short English section in `CLAUDE.md`: every write route is in the manifest; a new write route either records its audit row in the same transaction or is added as `exempt` with a reason; never add a `debt` entry for a new route.

## Acceptance

- `npm test -w apps/api` passes locally with the new test; `npm run check` passes.
- Adding a write route to a route file without a manifest entry makes the test fail (verified once, then reverted, by hand before the PR).
- The 23 debt entries match the map exactly.

## Open questions resolved here

- Where the manifest lives: under `tests/`, not `src/`, since no runtime code reads it.
- `login_events` counts as an audit table for this manifest even though it is not one of the three audit tables, because the map lists it as a record of login attempts that the throttle depends on.
