import { z } from 'zod';

// What a clinical revision stores (docs/specs/SPEC-clinical-revisions.md §3): a
// snapshot of the whole aggregate, as of the write that made it.
//
// One schema per aggregate and per schema_version, strict. A version once
// written is never changed: a new field is a new schema and a new version, and
// the old ones stay here, because the rows that hold them never change either.
// tests/historyProjectionCoverage.test.ts proves each one still parses.

const text = z.string().nullable();
const pain = z.number().int().nullable();

const SessionBlockSnapshotV1 = z.strictObject({
  episodeId: z.string(),
  preSessionState: text,
  treatment: text,
  painScaleBefore: pain,
  painScaleAfter: pain,
  patientExercises: text,
  reEvaluationNotes: text,
});

// The attending therapist, the type, the date (ISO), the text of a note, and
// the blocks ordered by episode.
export const SessionSnapshotV1 = z.strictObject({
  userId: z.string(),
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  sessionDate: z.string(),
  observations: text,
  episodes: z.array(SessionBlockSnapshotV1),
});

export type SessionSnapshotV1 = z.infer<typeof SessionSnapshotV1>;

export const SESSION_SNAPSHOT_VERSION = 1;

// ─── Patient ────────────────────────────────────────────────────────────────

// Identification and clinical context (SPEC-clinical-revisions.md §1). Contact
// and coverage are not versioned: their changes are named in the audit row
// only. A date of birth is the ISO string of its UTC midnight, as the DTO
// sends it.
export const PatientSnapshotV1 = z.strictObject({
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string().nullable(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable(),
  occupation: text,
  referringDoctor: text,
});

export type PatientSnapshotV1 = z.infer<typeof PatientSnapshotV1>;

export const PATIENT_SNAPSHOT_VERSION = 1;

// ─── Episode ────────────────────────────────────────────────────────────────

// Its complaint, status and dates (ISO).
export const EpisodeSnapshotV1 = z.strictObject({
  status: z.enum(['ACTIVE', 'DISCHARGED', 'ABANDONED']),
  mainComplaint: text,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});

export type EpisodeSnapshotV1 = z.infer<typeof EpisodeSnapshotV1>;

export const EPISODE_SNAPSHOT_VERSION = 1;

// ─── Initial evaluation ─────────────────────────────────────────────────────

// The body map stays unknown inside the snapshot, as in its column, until its
// shape is defined. evaluatedAt as ISO.
export const EvaluationSnapshotV1 = z.strictObject({
  patientNarrative: text,
  otherHistory: text,
  notes: text,
  retractionMap: z.unknown(),
  physicalActivity: text,
  painFrequency: text,
  evaScale: z.number().nullable(),
  evaluatedAt: z.string(),
});

export type EvaluationSnapshotV1 = z.infer<typeof EvaluationSnapshotV1>;

export const EVALUATION_SNAPSHOT_VERSION = 1;

// ─── Informed consent ───────────────────────────────────────────────────────

// When it was signed and, if it was, revoked (ISO). Signed is derived from them.
export const ConsentSnapshotV1 = z.strictObject({
  signedAt: z.string(),
  revokedAt: z.string().nullable(),
});

export type ConsentSnapshotV1 = z.infer<typeof ConsentSnapshotV1>;

export const CONSENT_SNAPSHOT_VERSION = 1;

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

export const PATIENT_EVENT_SNAPSHOT_VERSION = 1;
