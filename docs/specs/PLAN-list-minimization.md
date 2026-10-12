# PLAN: list-minimization

Spec: [`SPEC-list-minimization.md`](SPEC-list-minimization.md). Map: [`audit-map.md`](audit-map.md). There is no migration. Another session is working on `audit-structured-entries` in its own worktree, so this plan does not touch the audit write paths, and edits `CLAUDE.md` and `audit-map.md` in one small commit at the end.

## Tasks

1. **The sessions index (API).** `SessionIndexItemDTO` and `listIndexForTenant`, with a select narrowed to what it returns. `GET /api/sessions` returns it.
   - *Acceptance:* `globalSessions.test.ts` pins the new shape. No clinical field and no complaint appears.
2. **The agenda (API).** `GET /api/appointments` drops `episodeMainComplaint` and `notes`. `GET /api/appointments/:appointmentId` returns one appointment with its notes.
   - *Acceptance:* `appointments.test.ts` covers both: the own clinic, another clinic's (`404`) and a malformed id (`404`).
   - The param is registered (`idParamCoverage`).
3. **Alerts, dashboard and packages (API).**
   - The follow-up message carries no complaint, and `listStale` no longer selects one.
   - `POST /api/alerts` accepts only `CUSTOM`.
   - The donut skips deleted patients.
   - `GET /api/packages` requires `patientId`.
   - *Acceptance:* each change has its own test.
4. **The guard.** `tests/listScopeManifest.ts` and `tests/listMinimization.test.ts`, as spec §6 describes.
   - *Inventory:* every `GET` is classified.
   - *Probe:* a fixture filled with markers taken from the DMMF; positive controls; no marker anywhere; key sets pinned recursively; the two allowlisted paths.
   - *Acceptance:* the test is green, and a clinical field added back to the index makes it fail (checked once by hand, then reverted).
5. **Sesiones (web).**
   - A `SessionIndexItem` type that does not extend `Session`.
   - The page drops its clinical columns.
   - "Ver detalles" fetches the session and renders the dialog only with that data. A `404` shows a message, and the selection is cleared before invalidating.
   - *Acceptance:* the tests from the spec, including "an untouched save sends back the loaded values".
6. **Agenda (web).**
   - The list shows no complaint and no notes.
   - The dialog fetches its appointment for the notes, and shows the complaint only after "Ver motivo".
   - *Acceptance:* the dialog and agenda tests.
7. **Hints and logout (web).**
   - The "no clinical data here" hint on the payment notes field and the package name field. No web form creates custom alerts.
   - `logout` and the 401 handler clear the query cache.
   - *Acceptance:* the tests.
8. **Docs.** A short rule in `CLAUDE.md` (global lists carry no clinical text; classify every new `GET`), and the map's row marked as implemented.
9. **PR.**
   - The full local suites before the push: `npm test`, `npm test -w apps/web`, `npm run check`.
   - A by-hand look at *Sesiones* and the agenda.
   - PR against `dev`, with auto-merge (merge commit) and Auto-fix.

## Out of scope

Logging reads, pagination, and rewriting stored alert messages.
