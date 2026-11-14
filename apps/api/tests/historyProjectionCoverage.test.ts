import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_SNAPSHOTS,
  ConsentSnapshotV1,
  EPISODE_SNAPSHOTS,
  EVALUATION_SNAPSHOTS,
  EpisodeSnapshotV1,
  EvaluationSnapshotV1,
  PATIENT_EVENT_SNAPSHOTS,
  PATIENT_SNAPSHOTS,
  PatientEventSnapshotV1,
  PatientSnapshotV1,
  PatientSnapshotV2,
  SESSION_SNAPSHOTS,
  SessionSnapshotV1,
  type SnapshotHistory,
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
    projected: fieldsOf(PatientSnapshotV2),
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

// One stored snapshot per aggregate and schema version, as the database holds
// it. Every past version keeps its fixture here, with how it reads today
// (`current`: what its history answers for it). The latest version of each
// aggregate also has the row it is built from (`build`).
interface Stored {
  name: string;
  version: number;
  schema: { parse(value: unknown): unknown; safeParse(value: unknown): { success: boolean } };
  history: SnapshotHistory<unknown>;
  stored: unknown;
  build?: () => unknown;
  current?: unknown;
}

const PATIENT_V1 = {
  firstName: 'Ana',
  lastName: 'Pérez',
  birthDate: '1980-05-03T00:00:00.000Z',
  sex: 'FEMALE',
  occupation: 'Docente',
  referringDoctor: null,
};

const STORED: Stored[] = [
  {
    name: 'session',
    version: 1,
    schema: SessionSnapshotV1,
    history: SESSION_SNAPSHOTS,
    build: () => sessionSnapshot({ ...SESSION, sessionType: 'SESSION', sessionDate: new Date(SESSION.sessionDate) }),
    stored: undefined,
  },
  {
    // Before the document (2026-11): it reads today as a patient with none.
    name: 'patient',
    version: 1,
    schema: PatientSnapshotV1,
    history: PATIENT_SNAPSHOTS,
    stored: PATIENT_V1,
    current: { ...PATIENT_V1, documentType: null, documentNumber: null },
  },
  {
    name: 'patient',
    version: 2,
    schema: PatientSnapshotV2,
    history: PATIENT_SNAPSHOTS,
    build: () =>
      patientSnapshot({
        firstName: 'Ana',
        lastName: 'Pérez',
        birthDate: new Date('1980-05-03T00:00:00.000Z'),
        sex: 'FEMALE',
        documentType: 'DNI',
        documentNumber: '30123456',
        occupation: 'Docente',
        referringDoctor: null,
      }),
    stored: { ...PATIENT_V1, documentType: 'DNI', documentNumber: '30123456' },
  },
  {
    name: 'episode',
    version: 1,
    schema: EpisodeSnapshotV1,
    history: EPISODE_SNAPSHOTS,
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
    version: 1,
    schema: EvaluationSnapshotV1,
    history: EVALUATION_SNAPSHOTS,
    build: () =>
      evaluationSnapshot({
        patientNarrative: 'Dolor al levantarse',
        otherHistory: null,
        notes: null,
        physicalActivity: null,
        painFrequency: 'Diario',
        evaScale: 6,
        evaluatedAt: new Date('2026-10-01T12:00:00.000Z'),
      }),
    stored: {
      patientNarrative: 'Dolor al levantarse',
      otherHistory: null,
      notes: null,
      physicalActivity: null,
      painFrequency: 'Diario',
      evaScale: 6,
      evaluatedAt: '2026-10-01T12:00:00.000Z',
    },
  },
  {
    name: 'consent',
    version: 1,
    schema: ConsentSnapshotV1,
    history: CONSENT_SNAPSHOTS,
    build: () => consentSnapshot({ signedAt: new Date('2026-10-01T12:00:00.000Z'), revokedAt: null }),
    stored: { signedAt: '2026-10-01T12:00:00.000Z', revokedAt: null },
  },
  {
    name: 'patient event',
    version: 1,
    schema: PatientEventSnapshotV1,
    history: PATIENT_EVENT_SNAPSHOTS,
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
STORED[0].stored = SESSION;

describe('history projections', () => {
  it.each(Object.entries(COVERAGE))('holds every column of %s to a decision', (name, { projected, excluded }) => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
    const columns = model!.fields.filter((f) => f.kind !== 'object').map((f) => f.name);

    expect([...projected, ...Object.keys(excluded)].sort()).toEqual([...columns].sort());
  });

  it('has a fixture for every version of every aggregate', () => {
    const histories = [
      SESSION_SNAPSHOTS,
      PATIENT_SNAPSHOTS,
      EPISODE_SNAPSHOTS,
      EVALUATION_SNAPSHOTS,
      CONSENT_SNAPSHOTS,
      PATIENT_EVENT_SNAPSHOTS,
    ];
    for (const history of histories) {
      const versions = STORED.filter((s) => s.history === history).map((s) => s.version);
      expect(versions).toEqual(Array.from({ length: history.version }, (_, i) => i + 1));
    }
  });

  describe.each(STORED)('a v$version $name snapshot', ({ version, schema, history, build, stored, current }) => {
    it('still parses as stored', () => {
      expect(schema.parse(stored)).toEqual(stored);
    });

    it('refuses a field it does not know', () => {
      expect(schema.safeParse({ ...(stored as object), extra: 1 }).success).toBe(false);
    });

    // What the write path compares with and the history view shows.
    it('reads in the current shape through its history', () => {
      expect(history.read(version, stored)).toEqual(current ?? stored);
      expect(history.schema.safeParse(history.read(version, stored)).success).toBe(true);
    });

    it.skipIf(version !== history.version)('is the one the projection builds, with exactly its fields', () => {
      expect(build).toBeDefined();
      expect(schema.parse(build!())).toEqual(stored);
      expect(build!()).toEqual(stored);
    });
  });
});
