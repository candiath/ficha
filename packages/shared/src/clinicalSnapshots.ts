import { z } from 'zod';

// What a clinical revision stores (docs/specs/SPEC-clinical-revisions.md §3): a
// snapshot of the whole aggregate, as of the write that made it.
//
// One schema per aggregate and per schema_version, strict. A version once
// written is never changed: a new field is a new schema and a new version, and
// the old ones stay here, because the rows that hold them never change either.
// tests/historyProjectionCoverage.test.ts proves each one still parses.
//
// ─── Changing a snapshot ────────────────────────────────────────────────────
//
// Each aggregate has a history (`*_SNAPSHOTS`): its schemas, oldest first, and
// for every version after the first, how the one before reads in its shape
// (`upcast`). Everything that reads a stored snapshot goes through
// `history.read(schemaVersion, snapshot)`, which answers it in the CURRENT
// shape: the write path, to compare with what is being saved; the history
// view, to show it; the tests' invariant. Nothing rewrites a stored row.
//
// To add a field (the patient's document is the worked example, below):
//   1. write the new schema (`…SnapshotV2`) next to the old one;
//   2. append `{ schema, upcast }` to the history: the new field of an old
//      version is whatever "it was not recorded" means, usually null;
//   3. add the field to the projection (apps/api clinicalSnapshots.ts) and to
//      the renderer (apps/web revisionRows.ts).
// Removing a field is the same with an upcast that drops it; the history view
// then needs a renderer of its own for the old version, or what it held stops
// being shown. A new value of an enum is a new version too: the old schema
// stays as strict as the rows it describes.

export interface SnapshotHistory<Current> {
  /** The version new revisions are written with. */
  readonly version: number;
  /** The schema of that version. */
  readonly schema: z.ZodType<Current>;
  /**
   * A stored snapshot of any known version, in the current shape. null when
   * the version is unknown or the snapshot is not what its version says.
   */
  read(schemaVersion: number, snapshot: unknown): Current | null;
}

export interface SnapshotStep {
  readonly schema: z.ZodType;
  /**
   * How the version before reads in this one's shape; absent on the first.
   * Its argument is the previous version's snapshot, which `read` has just
   * parsed with that version's schema: each definition types it.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly upcast?: (previous: any) => unknown;
}

// `steps[0]` is version 1. Current is named by the caller: the type of the
// last schema.
export function snapshotHistory<Current>(steps: readonly [SnapshotStep, ...SnapshotStep[]]): SnapshotHistory<Current> {
  const current = steps[steps.length - 1].schema as z.ZodType<Current>;
  return {
    version: steps.length,
    schema: current,
    read(schemaVersion, snapshot) {
      if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > steps.length) return null;
      const stored = steps[schemaVersion - 1].schema.safeParse(snapshot);
      if (!stored.success) return null;
      let value: unknown = stored.data;
      for (const step of steps.slice(schemaVersion)) {
        if (!step.upcast) return null;
        value = step.upcast(value);
      }
      // An upcast that builds something other than its own schema is a bug of
      // this file: refused here, not carried into a comparison.
      const result = current.safeParse(value);
      return result.success ? result.data : null;
    },
  };
}

const text = z.string().nullable();
const pain = z.number().int().nullable();

const EncounterBlockSnapshotV1 = z.strictObject({
  episodeId: z.string(),
  preEncounterState: text,
  treatment: text,
  painScaleBefore: pain,
  painScaleAfter: pain,
  patientExercises: text,
  reEvaluationNotes: text,
});

// The attending therapist, the type, the date (ISO), the text of a note, and
// the blocks ordered by episode.
export const EncounterSnapshotV1 = z.strictObject({
  userId: z.string(),
  encounterType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  encounterDate: z.string(),
  observations: text,
  episodes: z.array(EncounterBlockSnapshotV1),
});

export type EncounterSnapshotV1 = z.infer<typeof EncounterSnapshotV1>;

export const ENCOUNTER_SNAPSHOTS = snapshotHistory<EncounterSnapshotV1>([{ schema: EncounterSnapshotV1 }]);
export const ENCOUNTER_SNAPSHOT_VERSION = ENCOUNTER_SNAPSHOTS.version;

// ─── Patient ────────────────────────────────────────────────────────────────

// Identification and clinical context (SPEC-clinical-revisions.md §1). Contact
// and coverage are not versioned: their changes are named in the audit row
// only. In version 1 a date of birth is the ISO string of its UTC midnight
// (1980-05-03T00:00:00.000Z); from version 2 it is the day (1980-05-03), as a
// patient event's occurredOn is.
export const PatientSnapshotV1 = z.strictObject({
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string().nullable(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable(),
  occupation: text,
  referringDoctor: text,
});

export type PatientSnapshotV1 = z.infer<typeof PatientSnapshotV1>;

// Version 2 adds the document that identifies her (2026-11): its type and its
// number, both or neither (patientDocument.ts). No production row holds
// version 1: it is kept as the worked example of a version change, and for
// the test databases. Version 2 was edited in place, before it was ever
// released, to hold the date of birth as the day (2026-11-15): no row of it
// carries the timestamp, so it needed no version 3.
export const PatientSnapshotV2 = z.strictObject({
  ...PatientSnapshotV1.shape,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  documentType: z.enum(['DNI', 'PASSPORT', 'FOREIGN_ID', 'OTHER']).nullable(),
  documentNumber: text,
});

export type PatientSnapshotV2 = z.infer<typeof PatientSnapshotV2>;

export const PATIENT_SNAPSHOTS = snapshotHistory<PatientSnapshotV2>([
  { schema: PatientSnapshotV1 },
  {
    schema: PatientSnapshotV2,
    // A version written before the document existed recorded none, and held
    // the date of birth as a timestamp: its first ten characters are the day.
    upcast: (v1: PatientSnapshotV1): PatientSnapshotV2 => ({
      ...v1,
      birthDate: v1.birthDate?.slice(0, 10) ?? null,
      documentType: null,
      documentNumber: null,
    }),
  },
]);
export const PATIENT_SNAPSHOT_VERSION = PATIENT_SNAPSHOTS.version;

// ─── Episode ────────────────────────────────────────────────────────────────

// Its complaint, status and dates (ISO).
export const EpisodeSnapshotV1 = z.strictObject({
  status: z.enum(['ACTIVE', 'DISCHARGED', 'ABANDONED']),
  mainComplaint: text,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});

export type EpisodeSnapshotV1 = z.infer<typeof EpisodeSnapshotV1>;

export const EPISODE_SNAPSHOTS = snapshotHistory<EpisodeSnapshotV1>([{ schema: EpisodeSnapshotV1 }]);
export const EPISODE_SNAPSHOT_VERSION = EPISODE_SNAPSHOTS.version;

// ─── Initial evaluation ─────────────────────────────────────────────────────

// evaluatedAt as ISO. The body map (retractionMap) left the evaluation before
// the relaunch, so no version of this schema that production holds ever had it.
// painScale (an integer from 0 to 10, named evaScale until 2026-11-15) was
// edited in place, with no version 2: no real row of this schema exists, so no
// stored snapshot names the old key or holds a decimal.
export const EvaluationSnapshotV1 = z.strictObject({
  patientNarrative: text,
  otherHistory: text,
  notes: text,
  physicalActivity: text,
  painFrequency: text,
  painScale: pain,
  evaluatedAt: z.string(),
});

export type EvaluationSnapshotV1 = z.infer<typeof EvaluationSnapshotV1>;

export const EVALUATION_SNAPSHOTS = snapshotHistory<EvaluationSnapshotV1>([{ schema: EvaluationSnapshotV1 }]);
export const EVALUATION_SNAPSHOT_VERSION = EVALUATION_SNAPSHOTS.version;

// ─── Informed consent ───────────────────────────────────────────────────────

// When it was signed and, if it was, revoked (ISO). Signed is derived from them.
export const ConsentSnapshotV1 = z.strictObject({
  signedAt: z.string(),
  revokedAt: z.string().nullable(),
});

export type ConsentSnapshotV1 = z.infer<typeof ConsentSnapshotV1>;

export const CONSENT_SNAPSHOTS = snapshotHistory<ConsentSnapshotV1>([{ schema: ConsentSnapshotV1 }]);
export const CONSENT_SNAPSHOT_VERSION = CONSENT_SNAPSHOTS.version;

// ─── Patient event ──────────────────────────────────────────────────────────

// Its three date columns as stored: the day (YYYY-MM-DD) the date is truncated
// to, its precision and the "approximate" mark; no date when she does not know.
export const PatientEventSnapshotV1 = z.strictObject({
  kind: z.enum(['FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER']),
  description: z.string(),
  occurredOn: z.string().nullable(),
  occurredPrecision: z.enum(['DAY', 'MONTH', 'YEAR']).nullable(),
  occurredApproximate: z.boolean(),
});

export type PatientEventSnapshotV1 = z.infer<typeof PatientEventSnapshotV1>;

export const PATIENT_EVENT_SNAPSHOTS = snapshotHistory<PatientEventSnapshotV1>([{ schema: PatientEventSnapshotV1 }]);
export const PATIENT_EVENT_SNAPSHOT_VERSION = PATIENT_EVENT_SNAPSHOTS.version;
