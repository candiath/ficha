import type {
  AuditAction,
  AuditEntity,
  ClinicalEpisode,
  InformedConsent,
  InitialEvaluation,
  Patient,
  PatientEvent,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  CONSENT_SNAPSHOT_VERSION,
  EPISODE_SNAPSHOT_VERSION,
  EVALUATION_SNAPSHOT_VERSION,
  PATIENT_EVENT_SNAPSHOT_VERSION,
  PATIENT_SNAPSHOT_VERSION,
  SESSION_SNAPSHOT_VERSION,
} from '@ficha/shared';
import {
  consentSnapshot,
  episodeSnapshot,
  evaluationSnapshot,
  patientEventSnapshot,
  patientSnapshot,
} from '../src/repositories/prisma/clinicalSnapshots';
import { sessionSnapshot } from '../src/repositories/prisma/sessionSnapshot';

// Version 1 of a clinical aggregate written straight to the database, by the
// seed and the test fixtures (tests/fixtures.ts): a SYSTEM audit row of its
// creation, since no user wrote it, and a revision equal to its rows
// (SPEC-clinical-revisions.md §9, checked by tests/revisionInvariant.ts). The
// caller passes the transaction that wrote the rows.

type Tx = Prisma.TransactionClient;

interface Owned {
  tenantId: string;
  patientId: string;
  id: string;
}

async function auditRow(tx: Tx, row: Owned, entity: AuditEntity, action: AuditAction, params: Prisma.InputJsonValue) {
  const { id } = await tx.auditLog.create({
    data: {
      tenantId: row.tenantId,
      patientId: row.patientId,
      entity,
      entityId: row.id,
      action,
      params,
      actorType: 'SYSTEM',
    },
    select: { id: true },
  });
  return id;
}

export const revisionFields = (row: Owned, auditLogId: string, schemaVersion: number, snapshot: unknown) => ({
  tenantId: row.tenantId,
  patientId: row.patientId,
  version: 1,
  auditLogId,
  schemaVersion,
  snapshot: snapshot as Prisma.InputJsonValue,
});

export async function patientVersionOne(tx: Tx, row: Patient): Promise<void> {
  const owned = { ...row, patientId: row.id };
  const auditLogId = await auditRow(tx, owned, 'PATIENT', 'PATIENT_CREATED', {});
  await tx.patientRevision.create({
    data: revisionFields(owned, auditLogId, PATIENT_SNAPSHOT_VERSION, patientSnapshot(row)),
  });
}

export async function episodeVersionOne(tx: Tx, row: ClinicalEpisode): Promise<void> {
  const auditLogId = await auditRow(tx, row, 'EPISODE', 'EPISODE_OPENED', {});
  await tx.episodeRevision.create({
    data: { ...revisionFields(row, auditLogId, EPISODE_SNAPSHOT_VERSION, episodeSnapshot(row)), episodeId: row.id },
  });
}

export async function evaluationVersionOne(tx: Tx, row: InitialEvaluation): Promise<void> {
  const auditLogId = await auditRow(tx, row, 'EVALUATION', 'EVALUATION_CREATED', {});
  await tx.evaluationRevision.create({
    data: {
      ...revisionFields(row, auditLogId, EVALUATION_SNAPSHOT_VERSION, evaluationSnapshot(row)),
      evaluationId: row.id,
    },
  });
}

export async function consentVersionOne(tx: Tx, row: InformedConsent): Promise<void> {
  const auditLogId = await auditRow(tx, row, 'CONSENT', 'CONSENT_SIGNED', {});
  await tx.consentRevision.create({
    data: { ...revisionFields(row, auditLogId, CONSENT_SNAPSHOT_VERSION, consentSnapshot(row)), consentId: row.id },
  });
}

export async function patientEventVersionOne(tx: Tx, row: PatientEvent): Promise<void> {
  const auditLogId = await auditRow(tx, row, 'PATIENT_EVENT', 'PATIENT_EVENT_RECORDED', { kind: row.kind });
  await tx.patientEventRevision.create({
    data: {
      ...revisionFields(row, auditLogId, PATIENT_EVENT_SNAPSHOT_VERSION, patientEventSnapshot(row)),
      patientEventId: row.id,
    },
  });
}

// The columns a session's snapshot is built from, blocks included.
export const sessionSnapshotSelect = {
  id: true,
  tenantId: true,
  patientId: true,
  userId: true,
  sessionType: true,
  sessionDate: true,
  observations: true,
  episodes: { orderBy: { episodeId: 'asc' } },
} as const satisfies Prisma.SessionSelect;

type SessionRows = Prisma.SessionGetPayload<{ select: typeof sessionSnapshotSelect }>;

const SESSION_CREATED = { SESSION: 'SESSION_RECORDED', NOTE: 'NOTE_RECORDED', DISCHARGE: 'DISCHARGE_RECORDED' } as const;

export async function sessionVersionOne(tx: Tx, row: SessionRows): Promise<void> {
  const auditLogId = await auditRow(tx, row, 'SESSION', SESSION_CREATED[row.sessionType], {});
  await tx.sessionRevision.create({
    data: { ...revisionFields(row, auditLogId, SESSION_SNAPSHOT_VERSION, sessionSnapshot(row)), sessionId: row.id },
  });
}

// Gives version 1 to every clinical aggregate of the clinic that has no
// revision yet, each in its own transaction, reading its rows inside it. Version 1 is written once: a second
// run finds nothing to do. Returns how many aggregates it versioned.
export async function versionUnversioned(prisma: PrismaClient, tenantId: string): Promise<number> {
  const unversioned = { tenantId, revisions: { none: {} } };
  const pick = { select: { id: true } } as const;
  const [patients, episodes, evaluations, consents, events, sessions] = await Promise.all([
    prisma.patient.findMany({ where: unversioned, ...pick }),
    prisma.clinicalEpisode.findMany({ where: unversioned, ...pick }),
    prisma.initialEvaluation.findMany({ where: unversioned, ...pick }),
    prisma.informedConsent.findMany({ where: unversioned, ...pick }),
    prisma.patientEvent.findMany({ where: unversioned, ...pick }),
    prisma.session.findMany({ where: unversioned, ...pick }),
  ]);

  const each = <T>(ids: { id: string }[], write: (tx: Tx, id: string) => Promise<T>) =>
    Promise.all(
      ids.map(({ id }) =>
        prisma.$transaction(async (tx) => {
          await write(tx, id);
        }),
      ),
    );

  // Patients first: the others name them, and a patient's version comes first.
  await each(patients, async (tx, id) => patientVersionOne(tx, await tx.patient.findUniqueOrThrow({ where: { id } })));
  await Promise.all([
    each(episodes, async (tx, id) =>
      episodeVersionOne(tx, await tx.clinicalEpisode.findUniqueOrThrow({ where: { id } })),
    ),
    each(evaluations, async (tx, id) =>
      evaluationVersionOne(tx, await tx.initialEvaluation.findUniqueOrThrow({ where: { id } })),
    ),
    each(consents, async (tx, id) =>
      consentVersionOne(tx, await tx.informedConsent.findUniqueOrThrow({ where: { id } })),
    ),
    each(events, async (tx, id) =>
      patientEventVersionOne(tx, await tx.patientEvent.findUniqueOrThrow({ where: { id } })),
    ),
    each(sessions, async (tx, id) =>
      sessionVersionOne(tx, await tx.session.findUniqueOrThrow({ where: { id }, select: sessionSnapshotSelect })),
    ),
  ]);
  return patients.length + episodes.length + evaluations.length + consents.length + events.length + sessions.length;
}
