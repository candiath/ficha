# Initial evaluation for conventional physiotherapy

Idea one-pager (2026-10-13), part of the relaunch (#238). The spec comes after the open questions are answered.

## Problem statement

How might the initial evaluation record facts that do not age, and only what the therapist who fills it uses?

Two things are wrong today:

- **Relative dates age.** "Fractura hace dos meses" or a pain onset of "hace 2 meses" are free text: a year later the record still says "hace 2 meses".
- **RPG is built into every evaluation.** Global posture, morphotype, detailed breathing pattern, breathing notes, family pain and posture families belong to RPG (Reeducación Postural Global), a specialty of the therapist, not to conventional physiotherapy. Every therapist sees them.

## Recommended direction

**Patient history, and the episode's onset, as dated facts** (direction B below, to confirm).

- **Patient history ("Antecedentes")**: a list on the patient, not on the episode, so a fracture from years ago is entered once and seen from every episode. Each entry has a kind (`FRACTURE`, `SURGERY`, `TRAUMA`, `DIAGNOSIS`, `OTHER`), a description and an optional partial date. An entry without a date is allowed.
- **Episode onset**: the episode gets an onset date, which replaces "Momento de aparición del dolor" (the client uses it as the onset, not as a time of day). One per episode, by construction.
- **Partial dates**: a date, its precision (day, month or year) and an "approximate" mark. The form accepts "hace 2 meses" and stores "~agosto 2026", computed from the day it is written, so it never ages. One schema in `packages/shared`, used by both.
- **RPG leaves the base evaluation** before the relaunch. It comes back, when a therapist needs it, as an extension (below).

### RPG as an extension

RPG depends on the therapist, not the clinic. Two separate questions:

- **Who may record RPG data**: the user's specialty. `User` gets `specialties` (an enum, `RPG` for now), set by the ADMIN in *Clínica → Usuarios*.
- **Which records hold RPG data**: the record itself, forever. A therapist without RPG reads the RPG data of a record and does not edit it (decided 2026-10-13).

The data goes in its own table whose primary key is the evaluation's id (one table per subtype):

```prisma
model RpgEvaluation {
  evaluationId String @id @map("evaluation_id") @db.Uuid  // PK = FK: one-to-one by construction
  tenantId     String @map("tenant_id") @db.Uuid
  // global posture, morphotype, breathing pattern and detail, family pain,
  // posture families (Json, shape in packages/shared)
  evaluation InitialEvaluation @relation(fields: [tenantId, evaluationId],
                                         references: [tenantId, id], onDelete: Restrict)
  @@map("rpg_evaluations")
}
```

- The row existing is what makes an evaluation RPG: no modality column to keep in sync.
- The base table does not change when another specialty arrives.
- The composite key keeps the row inside its clinic; the model goes in `TENANT_SCOPED_MODELS`.
- For audit it is still the evaluation: its fields are `changedFields` of the evaluation's update, no new entity.

The opposite direction (a nullable `rpg_data_id` on the evaluation) needs a `UNIQUE` to stay one-to-one, allows RPG rows nobody points to, and adds a column to the base table per specialty. A JSON column with a discriminator was also discarded: Postgres validates nothing inside it.

**Timing**: building the extension only adds, so it costs the same before or after the relaunch. It is not part of the relaunch. The removed code (`packages/shared/src/postureFamilies.ts`, `PostureFamiliesTables.tsx`) is recoverable from git.

## Directions considered

**A. Everything is an event.** One list of patient events; the pain onset is one more event (`PAIN_ONSET`) linked to its episode. One concept fewer, but "the onset of this episode" becomes a search that can find zero, two, or an onset with no episode, unless a partial unique index forbids it.

**B. Patient history plus the episode's onset** (recommended). The onset is a field of the episode, so there is exactly one or none, and the time since onset is a column read. The history list stays clean.

Both use the same partial date and accept "hace X".

## Decisions (2026-10-13)

- The client starts using Ficha only when everything pending only adds: whatever removes or renames goes before the relaunch, because afterwards audit rows and real clinical data make it permanent.
- Patient history belongs to the patient.
- An entry without a date is allowed.
- "Historia clínica" (`medicalHistory`) stays, for the exceptional, with a new label.
- RPG is the therapist's specialty; a therapist without it only reads RPG data.
- Everything removed goes in one release, an exception to the two-release rule for destructive migrations: nobody uses the app until the relaunch and production is wiped anyway. Written down in the PR that does it.

## Key assumptions to validate

- [ ] The client enters dates if the field accepts "hace X". *How*: show her that one field before building the rest.
- [ ] An episode has one onset, and a relapse is a new episode. *How*: ask her.
- [ ] The history entries she records today have a date, even an approximate one. *How*: ask which ones she writes down.

## MVP scope (before the relaunch)

- Patient history, with partial dates.
- Episode onset, replacing "Momento de aparición del dolor".
- RPG fields removed from `initial_evaluations` and from the form, with `postureFamilies.ts`, its component, and the JSON section of `CLAUDE.md` rewritten around another example.
- The two "Motivo de consulta" fields resolved, and the new label of "Historia clínica".
- Whatever the client decides about the retraction map, the flexibility test and the foot evaluation, if it removes or renames.

Each new piece follows the usual rules: catalog actions, the audit and list manifests, the tenant guard, `idParam`.

## Not doing (and why)

- **The RPG extension** (`rpg_evaluations`, user specialties): it only adds; built when a therapist needs it.
- **Precautions and contraindications banner** in sessions (pacemaker, metal implants, pregnancy, osteoporosis, anticoagulation, oncological history): it only adds; first candidate after the relaunch.
- **Acute / subacute / chronic label** from the onset date: display only, cheap once the date exists.
- **Onset mechanism** (traumatic, insidious, post-surgical) and linking an onset to a history entry: they only add.
- **SOAP structure with objective measures** (goniometry, strength 0–5, special tests) and generic scales such as the PSFS: the most expensive, and it only adds.
- **ICD-10 coding of diagnoses**: useful for insurers, and it only adds.
- **Templates per specialty**: the extension pattern covers the one specialty there is.

## Open questions

- **Direction A or B.**
- **Two "Motivo de consulta"**: the episode's (`ClinicalEpisode.mainComplaint`, asked when the episode is created; it names the episode and feeds the dashboard's chart) and the evaluation's (`InitialEvaluation.reasonForConsultation`), with the same label and never synchronized. Proposal: the episode's stays as the short name ("Lumbalgia"), the evaluation's becomes "Relato del paciente" (what happened and how it started).
- **New label for "Historia clínica"**. Proposal: "Otros antecedentes".
- **For the client**: the retraction map (proposal: it becomes a pain body chart, the conventional one), the flexibility / shortening test, the foot evaluation.
- **For the RPG extension, later**: whether an RPG session records something of its own (the postures worked, the time in each). If it does, the session gets the same kind of extension.
