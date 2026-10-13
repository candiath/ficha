# Initial evaluation for conventional physiotherapy

Idea one-pager (2026-10-13), part of the relaunch (#238). The spec comes after the open questions are answered.

## Problem statement

How might the initial evaluation record facts that do not age, and only what the therapist who fills it uses?

Two things are wrong today:

- **Relative dates age.** "Fractura hace dos meses" or a pain onset of "hace 2 meses" are free text: a year later the record still says "hace 2 meses".
- **RPG is built into every evaluation.** Global posture, morphotype, detailed breathing pattern, breathing notes, family pain and posture families belong to RPG (Reeducación Postural Global), a specialty of the therapist, not to conventional physiotherapy. Every therapist sees them.

## Recommended direction

**What the patient lived is one thing; the treatments are another.**

- **Events** belong to the patient: a fracture, a surgery, a trauma, a diagnosis, the onset of a pain. Each has a kind (`FRACTURE`, `SURGERY`, `TRAUMA`, `DIAGNOSIS`, `PAIN_ONSET`, `OTHER`), a description and an optional partial date. An event without a date is allowed. Entered once, seen from every treatment.
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

## Directions discarded

- **The onset as a field of the episode** (recommended in an earlier draft, to guarantee one onset per treatment). It mixes the patient's history with the treatment: no part of the system needs that guarantee, and a second treatment for the same problem would copy the onset.
- **RPG as a one-to-one extension of the initial evaluation** (primary key = the evaluation's id). An RPG assessment is repeated, so it cannot be one per evaluation.
- **A JSON column with a specialty discriminator**: Postgres validates nothing inside it.

## Decisions (2026-10-13)

- The client starts using Ficha only when everything pending only adds: whatever removes or renames goes before the relaunch, because afterwards audit rows and real clinical data make it permanent.
- Events belong to the patient, and an event may have no date. Treatments are a separate thing.
- RPG is the therapist's specialty; a therapist without it only reads RPG data. RPG assessments are many per treatment.
- "Historia clínica" (`medicalHistory`) stays, for the exceptional, renamed "Otros antecedentes".
- The two "Motivo de consulta": the episode's (`mainComplaint`) stays as the treatment's short name; the evaluation's (`reasonForConsultation`) becomes "Relato del paciente" (what happened and how it started).
- Everything removed goes in one release, an exception to the two-release rule for destructive migrations: nobody uses the app until the relaunch and production is wiped anyway. Written down in the PR that does it.

## Key assumptions to validate

- [ ] The client enters dates if the field accepts "hace X". *How*: show her that one field before building the rest.
- [ ] The events she records today have a date, even an approximate one, more often than not. *How*: ask which ones she writes down.
- [ ] An RPG assessment belongs to one treatment. *How*: ask her whether a new treatment starts from the last assessment or from scratch.

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
- **Final notes**: tools like Cliniko let a note be saved as a draft, editable, or as final, locked, with corrections as addenda. It fits the law's demand that an electronic record be unalterable (Ley 26.529, art. 13), and it only adds. Worth its own issue.
- **SOAP structure with objective measures** (goniometry, strength 0–5, special tests) and generic scales such as the PSFS: the most expensive, and it only adds.
- **ICD-10 coding of diagnoses**: useful for insurers, and it only adds.

## Open questions

- **The name of the events list in the UI**: "Antecedentes" (next to "Otros antecedentes") or "Eventos".
- **For the client**: the retraction map (proposal: it becomes a pain body chart, the conventional one), the flexibility / shortening test, the foot evaluation.
- **For the RPG assessments, later**: whether they belong to one treatment or to the patient.
