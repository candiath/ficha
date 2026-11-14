import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  ConsentSnapshotV1,
  EpisodeSnapshotV1,
  EvaluationSnapshotV1,
  PatientEventSnapshotV1,
  PatientSnapshotV1,
  SessionSnapshotV1,
} from '@ficha/shared';
import { sessionSnapshot } from '../src/repositories/prisma/sessionSnapshot';
import {
  consentSnapshot,
  episodeSnapshot,
  evaluationSnapshot,
  patientEventSnapshot,
  patientSnapshot,
} from '../src/repositories/prisma/clinicalSnapshots';

// Every column of a versioned table is in its projection, or excluded here with
// its reason (SPEC-clinical-revisions.md §3). A new column fails until someone
// decides: a field left out by accident is history that cannot be recovered.

const IDENTITY = 'Identifies the row; the revision carries it in its own columns.';
const TIMESTAMP = 'When the row was written: the audit row says when each version was.';
const DELETION = 'Deleting is a version of its own, told by its audit action.';
const NOT_VERSIONED =
  'Contact and coverage are not versioned (spec §1): a change takes a version of unchanged content, and its audit row names it. ' +
  'Versioning them later is a schema bump.';

const fieldsOf = (schema: { shape: object }) => Object.keys(schema.shape);
const sessionFields = fieldsOf(SessionSnapshotV1).filter((field) => field !== 'episodes');
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
      deletedAt: DELETION,
    },
  },
  SessionEpisode: {
    projected: blockFields,
    excluded: { tenantId: IDENTITY, patientId: IDENTITY, sessionId: IDENTITY },
  },
  Patient: {
    projected: fieldsOf(PatientSnapshotV1),
    excluded: {
      id: IDENTITY,
      tenantId: IDENTITY,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      deletedAt: DELETION,
      phone: NOT_VERSIONED,
      insuranceName: NOT_VERSIONED,
      insuranceNumber: NOT_VERSIONED,
      insurancePlan: NOT_VERSIONED,
    },
  },
  ClinicalEpisode: {
    projected: fieldsOf(EpisodeSnapshotV1),
    excluded: { id: IDENTITY, tenantId: IDENTITY, patientId: IDENTITY, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
  },
  InitialEvaluation: {
    projected: fieldsOf(EvaluationSnapshotV1),
    excluded: {
      id: IDENTITY,
      tenantId: IDENTITY,
      patientId: IDENTITY,
      episodeId: 'The episode the evaluation is of: it never changes, and identifies the row with it.',
      updatedAt: TIMESTAMP,
    },
  },
  InformedConsent: {
    projected: fieldsOf(ConsentSnapshotV1),
    excluded: { id: IDENTITY, tenantId: IDENTITY, patientId: IDENTITY, createdAt: TIMESTAMP, updatedAt: TIMESTAMP },
  },
  PatientEvent: {
    projected: fieldsOf(PatientEventSnapshotV1),
    excluded: {
      id: IDENTITY,
      tenantId: IDENTITY,
      patientId: IDENTITY,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      deletedAt: DELETION,
    },
  },
};

const ID_1 = '019a0000-0000-7000-8000-000000000001';
const ID_2 = '019a0000-0000-7000-8000-000000000002';

// One stored v1 snapshot per aggregate, as the database holds it, and the row
// it was built from. Every past schema version keeps its fixture here.
const V1 = [
  {
    name: 'session',
    schema: SessionSnapshotV1,
    build: () => sessionSnapshot({ ...SESSION, sessionType: 'SESSION', sessionDate: new Date(SESSION.sessionDate) }),
    stored: undefined as unknown,
  },
  {
    name: 'patient',
    schema: PatientSnapshotV1,
    build: () =>
      patientSnapshot({
        firstName: 'Ana',
        lastName: 'Pérez',
        birthDate: new Date('1980-05-03T00:00:00.000Z'),
        sex: 'FEMALE',
        occupation: 'Docente',
        referringDoctor: null,
      }),
    stored: {
      firstName: 'Ana',
      lastName: 'Pérez',
      birthDate: '1980-05-03T00:00:00.000Z',
      sex: 'FEMALE',
      occupation: 'Docente',
      referringDoctor: null,
    },
  },
  {
    name: 'episode',
    schema: EpisodeSnapshotV1,
    build: () =>
      episodeSnapshot({
        status: 'DISCHARGED',
        mainComplaint: 'Lumbalgia',
        openedAt: new Date('2026-10-01T12:00:00.000Z'),
        closedAt: new Date('2026-11-01T12:00:00.000Z'),
      }),
    stored: {
      status: 'DISCHARGED',
      mainComplaint: 'Lumbalgia',
      openedAt: '2026-10-01T12:00:00.000Z',
      closedAt: '2026-11-01T12:00:00.000Z',
    },
  },
  {
    name: 'evaluation',
    schema: EvaluationSnapshotV1,
    build: () =>
      evaluationSnapshot({
        patientNarrative: 'Dolor al levantarse',
        otherHistory: null,
        notes: null,
        retractionMap: [{ x: 1, y: 2 }],
        physicalActivity: null,
        painFrequency: 'Diario',
        evaScale: 6,
        evaluatedAt: new Date('2026-10-01T12:00:00.000Z'),
      }),
    stored: {
      patientNarrative: 'Dolor al levantarse',
      otherHistory: null,
      notes: null,
      retractionMap: [{ x: 1, y: 2 }],
      physicalActivity: null,
      painFrequency: 'Diario',
      evaScale: 6,
      evaluatedAt: '2026-10-01T12:00:00.000Z',
    },
  },
  {
    name: 'consent',
    schema: ConsentSnapshotV1,
    build: () => consentSnapshot({ signedAt: new Date('2026-10-01T12:00:00.000Z'), revokedAt: null }),
    stored: { signedAt: '2026-10-01T12:00:00.000Z', revokedAt: null },
  },
  {
    name: 'patient event',
    schema: PatientEventSnapshotV1,
    build: () =>
      patientEventSnapshot({
        kind: 'FRACTURE',
        description: 'Fractura de muñeca',
        occurredOn: new Date('2019-05-01T00:00:00.000Z'),
        occurredPrecision: 'MONTH',
        occurredApproximate: true,
      }),
    stored: {
      kind: 'FRACTURE',
      description: 'Fractura de muñeca',
      occurredOn: '2019-05-01',
      occurredPrecision: 'MONTH',
      occurredApproximate: true,
    },
  },
];

const SESSION = {
  userId: ID_1,
  sessionType: 'SESSION',
  sessionDate: '2026-11-06T12:00:00.000Z',
  observations: null,
  episodes: [
    {
      episodeId: ID_2,
      preSessionState: 'Llegó con dolor',
      treatment: null,
      painScaleBefore: 7,
      painScaleAfter: null,
      patientExercises: null,
      reEvaluationNotes: null,
    },
  ],
};
V1[0].stored = SESSION;

describe('history projections', () => {
  it.each(Object.entries(COVERAGE))('holds every column of %s to a decision', (name, { projected, excluded }) => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
    const columns = model!.fields.filter((f) => f.kind !== 'object').map((f) => f.name);

    expect([...projected, ...Object.keys(excluded)].sort()).toEqual([...columns].sort());
  });

  describe.each(V1)('a v1 $name snapshot', ({ schema, build, stored }) => {
    it('is built with exactly the fields of the schema', () => {
      expect(schema.parse(build())).toEqual(stored);
      expect(build()).toEqual(stored);
    });

    it('still parses as stored', () => {
      expect(schema.parse(stored)).toEqual(stored);
    });

    it('refuses a field it does not know', () => {
      expect(schema.safeParse({ ...(stored as object), extra: 1 }).success).toBe(false);
    });
  });
});
