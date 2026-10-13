# Initial evaluation for conventional physiotherapy

Idea one-pager (2026-10-13), part of the relaunch (#238). The spec comes after the open questions are answered.

## Problem statement

How might the initial evaluation record facts that do not age, and only what the therapist who fills it uses?

Two things are wrong today:

- **Relative dates age.** "Fractura hace dos meses" or a pain onset of "hace 2 meses" are free text: a year later the record still says "hace 2 meses".
- **RPG is built into every evaluation.** Global posture, morphotype, detailed breathing pattern, breathing notes, family pain and posture families belong to RPG (Reeducación Postural Global), a specialty of the therapist, not to conventional physiotherapy. Every therapist sees them.

## Recommended direction

**What the patient lived is one thing; the treatments are another.**

- **Events** ("Antecedentes" in the UI) belong to the patient: a fracture, a surgery, a trauma, a diagnosis, the onset of a pain. Each has a kind (`FRACTURE`, `SURGERY`, `TRAUMA`, `DIAGNOSIS`, `PAIN_ONSET`, `OTHER`), a description and an optional partial date. An event without a date is allowed. Entered once, seen from every treatment.
- **Treatments** are the episodes (`ClinicalEpisode`), with what is recorded inside them: the initial evaluation, the RPG assessments, the sessions, the scales. A treatment does not store when the problem began.
- **Partial dates**: a date, its precision (day, month or year) and an "approximate" mark. The form accepts "hace 2 meses" and stores "~agosto 2026", computed from the day it is written, so it never ages. One schema in `packages/shared`.
- **"Momento de aparición del dolor" is removed** from the evaluation. The onset is a `PAIN_ONSET` event, which the evaluation form can create without leaving it.

This is the same split as FHIR's: `Condition.onset` is when the problem began, in the clinician's opinion, and `EpisodeOfCare.period` is when someone was responsible for its care; one is not derived from the other. A patient who comes back a year later for the same back pain starts a new treatment, and the onset of the pain is still the same event.

Linking a treatment to the events behind it ("this treatment is for that pain") is not needed by any part of the system today, and it only adds: it can come later.

### RPG as its own record, inside the treatment

RPG depends on the therapist, not the clinic. Two separate questions:

- **Who may record RPG data**: the user's specialty. `User` gets `specialties` (an enum, `RPG` for now), set by the ADMIN in *Clínica → Usuarios*.
- **Which treatments hold RPG data**: the records themselves, forever. A therapist without RPG reads them and does not edit them (decided 2026-10-13).

An RPG assessment is recorded once, and again when there is no improvement (the client, 2026-10-13). So it is not an extension of the initial evaluation but its own dated record, many per treatment, like a functional scale:

```prisma
model RpgAssessment {
  id         String   @id @default(uuid(7)) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  episodeId  String   @map("episode_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid        // the RPG therapist who recorded it
  assessedAt DateTime @map("assessed_at")
  // global posture, morphotype, breathing pattern and detail, family pain,
  // posture families (Json, shape in packages/shared)
  @@map("rpg_assessments")
}
```

- Typed columns rather than one JSON blob (as `FunctionalScale` keeps its `responses`): Postgres validates the columns, not what is inside a JSON.
- A new assessment can start as a copy of the previous one, so a re-assessment records what changed.
- Composite keys with `tenant_id` keep it inside its clinic; the model goes in `TENANT_SCOPED_MODELS`, with its own audit entity and catalog actions.

**Timing**: it only adds, so it is not part of the relaunch. The removed code (`packages/shared/src/postureFamilies.ts`, `PostureFamiliesTables.tsx`) is recoverable from git.

## Third direction: the form as a versioned template

Everything above keeps the evaluation's form as typed columns. The alternative changes how the form itself is stored; events and treatments stay as described.

**Why.** Nothing outside the evaluation's own route, repository and form reads its ~20 columns (checked 2026-10-13). Typed columns buy little there, and they make every correction of the form a migration: after the relaunch, a dead column and an audit code kept forever. That is the problem behind this whole document, and the client's next correction will hit it again.

**What.**

- The form is defined in `packages/shared`: sections and fields, each with a kind (text, choice, scale, date). It generalizes what `POSTURE_TABLES` already does for one grid.
- An evaluation stores the template it was filled with and the answers:

  ```
  initial_evaluations: id, tenant_id, patient_id, episode_id,
                       template_code 'INITIAL_EVALUATION', template_version 3,   ← typed
                       eva_scale 6,                                             ← typed
                       answers {"patientNarrative": "...", "painFrequency": "..."}
  ```

- A correction of the form is a new template version. Old evaluations keep rendering with theirs.
- The RPG assessment is another template instead of a typed `rpg_assessments` table, and the user's specialty decides which templates she can fill.

**What stays typed.** Everything the system computes with, filters by or shows elsewhere: patients, episodes, sessions, appointments, payments, packages, the patient's events with their partial dates, the EVA and the functional scales, consent, users, audit. Of the ~23 models, the initial evaluation gets a JSON column, and later the RPG assessment. JSON is not new in Ficha: `postureFamilies`, `familyPain*`, `retractionMap` and `FunctionalScale.responses` already are.

**What keeps it robust when Postgres does not look inside.**

- Each template version has a strict schema (`strictObject`, as `postureFamilies` today): an unknown key or a wrong type is a `400`.
- Versions only grow: a test pins the published versions and fails if one changes or disappears, like the audit catalog codes.
- `template_code` and `template_version` are typed columns, and a `CHECK` requires `answers` to be an object.
- Size is bounded twice: each text field has a maximum length in the version's schema, and a `CHECK (octet_length(answers::text) <= 65536)` is the net in the database. Today nothing bounds the evaluation's text but `express.json()`'s default 100 kB body. Like any long value, `answers` over ~2 kB is compressed and stored out of the row (TOAST); editing one field rewrites the whole document, which costs nothing at a few kB. Photos are never inside it: they stay files, as `EvaluationPhoto` already is.

**Querying.** Prisma stores `Json` as `jsonb`, parsed once on write, so reading a key (`answers->>'painFrequency'`) does not re-parse the row. Without an index, filtering on a key scans every row, as with an unindexed column. When a key needs it:

- an expression index on that key (`CREATE INDEX … ((answers->>'painFrequency'))`);
- a GIN index on `answers`, for containment (`@>`) and key existence (`?`);
- a stored generated column with the key cast to its type (`GENERATED ALWAYS AS ((answers->>'x')::int) STORED`), indexed like any column. A value that does not cast makes the write fail, so it also gives that one key a check in the database.

None of them can be declared in `schema.prisma`; they go as hand-written SQL in the migration, like the audit triggers. The real difficulty is not speed but meaning: a key may not exist in older versions, or may change between them, so a query across versions has to account for that, and Prisma's JSON filters are limited (a complex one needs `$queryRaw`, inside the repository).

**A middle ground**, if JSON is too loose: one row per answer, `(evaluation_id, field_code, value_text, value_number, value_date)`, with a `CHECK` that exactly one value is set. The database checks each answer's type without JSON; the cost is more rows, and assembling the form and auditing its changes gets harder.

| | Typed columns (the plan above) | Versioned template |
| --- | --- | --- |
| A correction after the relaunch | a migration; a dead column and an audit code forever | a new template version |
| Validation | each column's type, in the database | the object in the database; each field in the API, per version |
| Querying one field | a plain column | `jsonb` operators, an index when needed, across versions |
| Work before the relaunch | smaller: remove and rename columns, the events | larger: the template engine in `shared`, a generic form in the web, validation per version, the audit's `changedFields` as template field ids |
| The client's pending answers (map, flexibility, feet) | hold the relaunch | do not: they become versions |
| RPG | a typed `rpg_assessments` table, later | another template, later |
| Renames ("Relato del paciente", "Otros antecedentes") | renames of columns and codes | field ids chosen once, in the first version |

## Directions discarded

- **The onset as a field of the episode** (recommended in an earlier draft, to guarantee one onset per treatment). It mixes the patient's history with the treatment: no part of the system needs that guarantee, and a second treatment for the same problem would copy the onset.
- **RPG as a one-to-one extension of the initial evaluation** (primary key = the evaluation's id). An RPG assessment is repeated, so it cannot be one per evaluation.
- **A JSON column with a specialty discriminator**: Postgres validates nothing inside it.

## Decisions (2026-10-13)

- The client starts using Ficha only when everything pending only adds: whatever removes or renames goes before the relaunch, because afterwards audit rows and real clinical data make it permanent.
- Events belong to the patient, and an event may have no date. Treatments are a separate thing.
- RPG is the therapist's specialty; a therapist without it only reads RPG data. RPG assessments are many per treatment, and belong to the treatment (the episode), not to the patient.
- The events list is called "Antecedentes" in the UI.
- "Historia clínica" (`medicalHistory`) stays, for the exceptional, renamed "Otros antecedentes".
- The two "Motivo de consulta": the episode's (`mainComplaint`) stays as the treatment's short name; the evaluation's (`reasonForConsultation`) becomes "Relato del paciente" (what happened and how it started).
- Everything removed goes in one release, an exception to the two-release rule for destructive migrations: nobody uses the app until the relaunch and production is wiped anyway. Written down in the PR that does it.

## Key assumptions to validate

- [ ] The client enters dates if the field accepts "hace X". *How*: show her that one field before building the rest.
- [ ] The events she records today have a date, even an approximate one, more often than not. *How*: ask which ones she writes down.

## MVP scope (before the relaunch)

- Patient events, with partial dates.
- "Momento de aparición del dolor" removed; the onset recorded as an event.
- RPG fields removed from `initial_evaluations` and from the form, with `postureFamilies.ts`, its component, and the JSON section of `CLAUDE.md` rewritten around another example.
- The renames: "Relato del paciente", "Otros antecedentes".
- Whatever the client decides about the retraction map, the flexibility test and the foot evaluation, if it removes or renames.

Each new piece follows the usual rules: catalog actions, the audit and list manifests, the tenant guard, `idParam`.

## Not doing (and why)

- **RPG assessments and user specialties**: they only add; built when a therapist needs them.
- **Linking treatments to events**: nothing needs it yet, and it only adds.
- **A problem list with status** (FHIR's active / resolved conditions, with an end date): events cover what the client asked; an end date only adds.
- **Precautions and contraindications banner** in sessions (pacemaker, metal implants, pregnancy, osteoporosis, anticoagulation, oncological history): it only adds; first candidate after the relaunch.
- **Acute / subacute / chronic label** from the onset event: display only.
- **Final notes**: tools like Cliniko let a note be saved as a draft, editable, or as final, locked, with corrections as addenda. It fits the law's demand that an electronic record be unalterable (Ley 26.529, art. 13), and it only adds: #241.
- **SOAP structure with objective measures** (goniometry, strength 0–5, special tests) and generic scales such as the PSFS: the most expensive, and it only adds.
- **ICD-10 coding of diagnoses**: useful for insurers, and it only adds.

## Open questions

- **The form: typed columns or a versioned template** (third direction), and, with a template, JSON answers or one row per answer.
- **For the client**: for the retraction map, the flexibility / shortening test and the foot evaluation, whether each one is used in conventional physiotherapy (it stays in the initial evaluation), only in RPG (it moves to the RPG assessment), or not at all (it is removed). For the map, a conventional alternative: a pain body chart.
