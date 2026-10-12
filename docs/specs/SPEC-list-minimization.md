# Spec: list-minimization

Module of the [audit capability map](audit-map.md) (issue #186), decision 6: **global lists carry no clinical text**. Status: reviewed. An adversarial review ran before implementation (2026-10-11), and its findings are folded in, marked *(review)*.

## Objective

Clinical detail is read only inside a patient's record, so a single request cannot carry the clinical notes of the whole clinic.

`record-access-log` will record every read of a clinical record, per user, patient and hour. Any response that spans patients and carries clinical text makes that log blind: one request reads every record without opening any of them. So this module comes first.

### What counts as clinical text *(review: by model, not by field)*

**Clinical** is every column except keys and timestamps of:

- `Session`, `ClinicalEpisode` and `InitialEvaluation`, including its JSON columns and `evaScale`;
- `FunctionalScale`, including its type: an OSWESTRY scale means a lumbar problem;
- `InformedConsent`, whether signed or not.

It also covers anything derived from those columns: the complaint inside an engine alert, a pain trend.

**Not clinical:**

- **Who and when:** a patient's name and demographics, dates, a session's type (`NOTE` and `DISCHARGE` included), an appointment's status (`NO_SHOW` included).
- **Money:** amounts and payment statuses.
- **Counts.**

### Where we stand

| Response that spans patients | Clinical text in it today |
|---|---|
| `GET /api/sessions` | Every session of every patient, unpaginated, with all six clinical fields and each episode's complaint. Quick notes too: their whole content is `observations`. |
| `GET /api/appointments?from&to` (up to 62 days) | Each episode's complaint. Also `notes`: free text, up to 500 characters, shown by no list view. |
| `GET /api/alerts` | Follow-up messages embed the episode's complaint. Custom alerts are free text. |
| `GET /api/alerts/stats` | Nothing returned, but the engine it triggers reads every stale episode's complaint *(review)*. |
| `GET /api/dashboard/stats` | `pathologies[].name` is each episode's complaint verbatim, and a group of one is one patient's text *(review)*. Its `groupBy` does not skip deleted patients. |
| `GET /api/patients` | `referringDoctor`: free text that often carries a specialty *(review)*. See Open Question 2. |
| `GET /api/packages` without `patientId` | Package names are free text ("RPG escoliosis x10") *(review)*. No web code calls it without a patient. |
| `GET /api/payments` | Payment `notes` and package names (free text). |

## Design

### 1. `GET /api/sessions` becomes an index

**The API.**
- Each item is `{ id, sessionType, sessionDate, createdAt, updatedAt, patient: { id, fullName } }`, with nothing else *(review: no `episodeIds`, no duplicate `patientId`)*.
- The select itself narrows to these columns, so clinical text never leaves the database for this list.
- The repository method becomes `listIndexForTenant`, returning `SessionIndexItemDTO`.

**The web** *(review, high).* Loading the full session back into an edit form is where a partial object becomes data loss: under "un solo vacío", every empty field is saved as `null`. So:

- `SessionIndexItem` is a type of its own that does **not** extend `Session`, and nothing casts between them.
- *Sesiones* shows date, patient (linking to the record's *Sesiones* tab) and type.
- "Ver detalles" fetches the session from `GET /api/patients/:patientId/sessions/:sessionId`. The dialog renders **only once that data has arrived**, so it can never open in create mode, nor with empty fields.
- A `404` (the patient was deleted; the index keeps naming them, as Cobros does) shows "La ficha de este paciente ya no está disponible".
- Deleting from the dialog clears the selection before invalidating the list.

### 2. The agenda drops the complaint and the notes

**The API.** `GET /api/appointments` drops `episodeMainComplaint` and `notes`, and keeps `episodeId`. A new `GET /api/appointments/:appointmentId` returns one appointment with its `notes`; the repository's `getById` already exists.

**The web.**
- The list shows time, status and patient.
- The appointment dialog loads that one appointment for its notes.
- The episode's complaint stays behind an explicit **"Ver motivo"** button, which loads the patient's episodes *(review)*. People open the dialog to confirm, cancel or mark a no-show. Loading the record on every open would turn each of those into a clinical read for `record-access-log`, and a day of appointments into a burst.
- A `404` on the record is handled as in §1.

### 3. Alerts

- **The engine's follow-up message** carries no complaint: "Sin sesiones en 21 días en un episodio abierto. Considerá contactar al paciente o marcar el episodio como abandonado." `episodeRepo.listStale` stops selecting `mainComplaint` *(review)*. Payment messages keep their amounts and dates: money, not clinical text.
- **`POST /api/alerts` accepts only `CUSTOM`** *(review)*. Today it accepts every type with any text, so a user could type "engine text". No web code calls it today.
- **Existing rows keep their text.** They are not audit rows, and production is wiped before delivery (#223). That wipe is a precondition of `record-access-log` *(review)*.

### 4. Dashboard

- The complaints donut ignores deleted patients, as the other counts do.
- Whether to show small groups is Open Question 1.

### 5. Packages

`GET /api/packages` requires `patientId`. The only caller already sends it, and the change removes one list that spans patients *(review)*.

### 6. The guard: every GET is classified, and the cross-patient ones are probed *(review, high)*

`tests/listMinimization.test.ts`, in two parts.

**Inventory.** Every `GET` route is extracted from the source, as `auditCoverage.test.ts` does for writes, and classified in `listScopeManifest.ts` as one of:

- `patient`: its path is under `/api/patients/:patientId` or `/api/patients/:id`;
- `probed`: it spans patients, and the probe below checks it;
- `exempt`: with a reason. For example `/auth/me`, `/tenant`, `/users`, `/platform/*`, `/payments/last-base-price`, `/alerts/stats`.

A new `GET` without an entry fails the test.

**Probe.**
- **Fixture.** One clinic where every String and Json column of the clinical models holds a marker. The columns come from Prisma's DMMF, as `tenantScopeCoverage.test.ts` reads it, so a new column cannot be missed. Markers are short ASCII tokens with no separators (`MKa1b2`), searched as substrings.
  - The fixture fills every nullable relation: a payment with a package, an appointment with an episode.
  - It includes a session older than 21 days, so the engine creates its follow-up alert.
- **Positive controls.** Each `probed` route must return the fixture's own ids (session, appointment, alert, payment). An empty response cannot pass.
- **Assertions.**
  - No marker appears anywhere in the raw body.
  - The exact key set of every item, recursively, on every array element, matches the manifest.
- **Numbers.** Numeric clinical columns (pain, `evaScale`, scores) cannot hold a marker. The key pinning is their guard, and the manifest says so.

The dashboard's `pathologies[].name` is the one allowlisted path, governed by Open Question 1.

### 7. Logout clears the query cache *(review)*

Today `AuthContext.logout` and the 401 handler keep TanStack's cache for 5 minutes. The next person on the same tab sees the previous user's records from that cache, which `record-access-log` will never see. Both now call `queryClient.clear()`.

## Not in this module

- Logging reads (`record-access-log`).
- Paginating global lists.
- Rewriting stored alert messages.
- Per-patient routes: they are the record.

## Tech Stack, Commands

The existing stack. No migration, no new dependencies.

```
npm test                   # API (vitest + supertest, against Neon)
npm test -w apps/web       # web (vitest + jsdom)
npm run check              # lint + typecheck
```

## Testing Strategy

**API**
- §6.
- `globalSessions.test.ts` and `appointments.test.ts` move to the new shapes.
- `GET /api/appointments/:appointmentId`: own clinic, another clinic's (`404`), malformed id (`404`).
- `POST /api/alerts` rejects every type but `CUSTOM`.
- `GET /api/packages` without `patientId` returns `400`.
- The follow-up message is pinned without the complaint.
- The donut skips deleted patients.

**Web**
- *Sesiones* has no clinical column.
- "Ver detalles" fetches the session, renders nothing until the data arrives, and saving without touching anything sends back the loaded values.
- A `404` shows the message.
- The agenda list shows no complaint and no notes. The dialog shows the notes, and shows the complaint only after "Ver motivo".
- Logout clears the cache.

## Boundaries

- **Always:**
  - a response that spans patients selects only the columns it returns;
  - clinical detail comes from a route under `/api/patients/:patientId/…`;
  - an edit form renders only from the full record.
- **Ask first:**
  - adding a field to a `probed` route;
  - classifying a new `GET` as `exempt`.
- **Never:**
  - clinical text, or text derived from it, in a response that spans patients;
  - a list item passed to an edit form.

## Success Criteria

- [ ] The probe passes:
  - every `probed` route returns the fixture's ids;
  - no marker appears anywhere;
  - the key sets match the manifest.
- [ ] Every `GET` is classified.
- [ ] *Sesiones* and the agenda work as before for what they show. Their detail views load clinical text from the patient's routes, and an untouched save changes nothing.
- [ ] `npm test`, `npm test -w apps/web` and `npm run check` pass locally, and the CI passes.

## Open Questions

1. **The dashboard's complaints donut.** It shows each complaint verbatim, with its count. A group of one is one patient's text, though with no name attached.
   - **I recommend keeping it as it is, allowlisted in the test as an aggregate.** It names no patient, and today everyone who sees the dashboard can open every record anyway: there is no secretary role yet.
   - **The alternative:** hide groups below 3 patients, under "Otros". That is safer when a secretary role exists, but in a small clinic it empties the donut.
2. **`referringDoctor` in the patient list.** It is free text ("Dr. Pérez, traumatología"), returned for every patient. The list hides that column by default.
   - **I recommend moving it to `GET /api/patients/:id`**, and taking the optional column out of the list.
3. **Free text on administrative entities: payment `notes`, package names, custom alerts.** They are about money or a reminder, but a user can type anything into them.
   - **I recommend keeping them in the lists**, each with a hint in its form: "No escribas datos clínicos acá: van en la ficha del paciente."
   - Hiding payment notes would also require the edit dialog to fetch each payment. Today it takes its notes from the list item, so hiding them without that fetch would erase them on every edit (the §1 hazard).
   - Appointment notes are moved out (§2), because no list view shows them.
