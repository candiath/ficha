import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { SessionSnapshotV1 } from '@ficha/shared';
import { sessionSnapshot } from '../src/repositories/prisma/sessionSnapshot';

// Every column of a versioned table is in its projection, or excluded here with
// its reason (SPEC-clinical-revisions.md §3). A new column fails until someone
// decides: a field left out by accident is history that cannot be recovered.

const IDENTITY = 'Identifies the row; the revision carries it in its own columns.';
const TIMESTAMP = 'When the row was written: the audit row says when each version was.';

const sessionFields = Object.keys(SessionSnapshotV1.shape).filter((field) => field !== 'episodes');
const blockFields = Object.keys(SessionSnapshotV1.shape.episodes.element.shape);

const COVERAGE: Record<string, { projected: string[]; excluded: Record<string, string> }> = {
  Session: {
    projected: sessionFields,
    excluded: {
      id: IDENTITY,
      tenantId: IDENTITY,
      patientId: IDENTITY,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      deletedAt: 'Deleting is a version of its own, told by its audit action.',
    },
  },
  SessionEpisode: {
    projected: blockFields,
    excluded: { tenantId: IDENTITY, patientId: IDENTITY, sessionId: IDENTITY },
  },
};

const V1_FIXTURE = {
  userId: '019a0000-0000-7000-8000-000000000001',
  sessionType: 'SESSION',
  sessionDate: '2026-11-06T12:00:00.000Z',
  observations: null,
  episodes: [
    {
      episodeId: '019a0000-0000-7000-8000-000000000002',
      preSessionState: 'Llegó con dolor',
      treatment: null,
      painScaleBefore: 7,
      painScaleAfter: null,
      patientExercises: null,
      reEvaluationNotes: null,
    },
  ],
};

describe('history projections', () => {
  it.each(Object.entries(COVERAGE))('holds every column of %s to a decision', (name, { projected, excluded }) => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
    const columns = model!.fields.filter((f) => f.kind !== 'object').map((f) => f.name);

    expect([...projected, ...Object.keys(excluded)].sort()).toEqual([...columns].sort());
  });

  it('builds exactly the fields of the schema', () => {
    const snapshot = sessionSnapshot({ ...V1_FIXTURE, sessionType: 'SESSION', sessionDate: new Date(V1_FIXTURE.sessionDate) });
    expect(SessionSnapshotV1.parse(snapshot)).toEqual(V1_FIXTURE);
  });

  describe('a stored v1 session snapshot', () => {
    it('still parses', () => {
      expect(SessionSnapshotV1.parse(V1_FIXTURE)).toEqual(V1_FIXTURE);
    });

    it('refuses a field it does not know', () => {
      expect(SessionSnapshotV1.safeParse({ ...V1_FIXTURE, extra: 1 }).success).toBe(false);
    });
  });
});
