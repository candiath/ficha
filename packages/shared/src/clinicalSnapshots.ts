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
