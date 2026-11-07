import type {
  AuditAction,
  AuditEntity,
  ClinicalEpisode,
  InformedConsent,
  InitialEvaluation,
  Patient,
  PatientEvent,
  Prisma,
} from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  consentSnapshot,
  episodeSnapshot,
  evaluationSnapshot,
  patientEventSnapshot,
  patientSnapshot,
} from '../src/repositories/prisma/clinicalSnapshots';
import {
  CONSENT_SNAPSHOT_VERSION,
  EPISODE_SNAPSHOT_VERSION,
  EVALUATION_SNAPSHOT_VERSION,
  PATIENT_EVENT_SNAPSHOT_VERSION,
  PATIENT_SNAPSHOT_VERSION,
} from '@ficha/shared';

// Clinical rows written straight to the database, for tests about what reads
// them. Each comes as the app leaves one: with a SYSTEM audit row of its
// creation and version 1, which is what the revision invariant checks
// (tests/revisionInvariant.ts). Same call shape as the Prisma delegate, so a
// fixture reads like the insert it replaces: `fixture.patient.create({ data })`.
// A `select` is accepted and ignored: the whole row comes back.
//
// A test that expects an insert to fail keeps calling Prisma: no row, no version.
// Sessions have their own, createSessionFixture in tests/helpers.ts.

type Tx = Prisma.TransactionClient;

interface Created {
  tenantId: string;
  patientId: string;
  id: string;
}

// The creation's audit row: SYSTEM, since no user wrote the fixture.
async function auditRow(tx: Tx, row: Created, entity: AuditEntity, action: AuditAction, params: Prisma.InputJsonValue) {
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

const revision = (row: Created, auditLogId: string, schemaVersion: number, snapshot: unknown) => ({
  tenantId: row.tenantId,
  patientId: row.patientId,
  version: 1,
  auditLogId,
  schemaVersion,
  snapshot: snapshot as Prisma.InputJsonValue,
});

async function createPatient(tx: Tx, data: Prisma.PatientUncheckedCreateInput): Promise<Patient> {
  const row = await tx.patient.create({ data });
  const created = { ...row, patientId: row.id };
  const auditLogId = await auditRow(tx, created, 'PATIENT', 'PATIENT_CREATED', {});
  await tx.patientRevision.create({
    data: revision(created, auditLogId, PATIENT_SNAPSHOT_VERSION, patientSnapshot(row)),
  });
  return row;
}

async function createEpisode(tx: Tx, data: Prisma.ClinicalEpisodeUncheckedCreateInput): Promise<ClinicalEpisode> {
  const row = await tx.clinicalEpisode.create({ data });
  const auditLogId = await auditRow(tx, row, 'EPISODE', 'EPISODE_OPENED', {});
  await tx.episodeRevision.create({
    data: { ...revision(row, auditLogId, EPISODE_SNAPSHOT_VERSION, episodeSnapshot(row)), episodeId: row.id },
  });
  return row;
}

// A change written straight to an episode, with its audit row and its next
// version, as an edit through the app would leave it.
async function updateEpisode(
  tx: Tx,
  { where, data }: { where: { id: string }; data: Prisma.ClinicalEpisodeUncheckedUpdateInput },
): Promise<ClinicalEpisode> {
  const row = await tx.clinicalEpisode.update({ where, data });
  const latest = await tx.episodeRevision.findFirstOrThrow({
    where: { episodeId: row.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const auditLogId = await auditRow(tx, row, 'EPISODE', 'EPISODE_UPDATED', {});
  await tx.episodeRevision.create({
    data: {
      ...revision(row, auditLogId, EPISODE_SNAPSHOT_VERSION, episodeSnapshot(row)),
      version: latest.version + 1,
      episodeId: row.id,
    },
  });
  return row;
}

async function createEvaluation(
  tx: Tx,
  data: Prisma.InitialEvaluationUncheckedCreateInput,
): Promise<InitialEvaluation> {
  const row = await tx.initialEvaluation.create({ data });
  const auditLogId = await auditRow(tx, row, 'EVALUATION', 'EVALUATION_CREATED', {});
  await tx.evaluationRevision.create({
    data: { ...revision(row, auditLogId, EVALUATION_SNAPSHOT_VERSION, evaluationSnapshot(row)), evaluationId: row.id },
  });
  return row;
}

async function createConsent(tx: Tx, data: Prisma.InformedConsentUncheckedCreateInput): Promise<InformedConsent> {
  const row = await tx.informedConsent.create({ data });
  const auditLogId = await auditRow(tx, row, 'CONSENT', 'CONSENT_SIGNED', {});
  await tx.consentRevision.create({
    data: { ...revision(row, auditLogId, CONSENT_SNAPSHOT_VERSION, consentSnapshot(row)), consentId: row.id },
  });
  return row;
}

async function createPatientEvent(tx: Tx, data: Prisma.PatientEventUncheckedCreateInput): Promise<PatientEvent> {
  const row = await tx.patientEvent.create({ data });
  const auditLogId = await auditRow(tx, row, 'PATIENT_EVENT', 'PATIENT_EVENT_RECORDED', { kind: row.kind });
  await tx.patientEventRevision.create({
    data: {
      ...revision(row, auditLogId, PATIENT_EVENT_SNAPSHOT_VERSION, patientEventSnapshot(row)),
      patientEventId: row.id,
    },
  });
  return row;
}

function delegate<D, R>(create: (tx: Tx, data: D) => Promise<R>) {
  return {
    create: ({ data }: { data: D; select?: unknown }): Promise<R> => prisma.$transaction((tx) => create(tx, data)),
    createMany: ({ data }: { data: D[] }): Promise<R[]> =>
      prisma.$transaction(async (tx) => {
        const rows: R[] = [];
        for (const one of data) rows.push(await create(tx, one));
        return rows;
      }),
  };
}

export const fixture = {
  patient: delegate(createPatient),
  clinicalEpisode: {
    ...delegate(createEpisode),
    update: (args: Parameters<typeof updateEpisode>[1]): Promise<ClinicalEpisode> =>
      prisma.$transaction((tx) => updateEpisode(tx, args)),
  },
  initialEvaluation: delegate(createEvaluation),
  informedConsent: delegate(createConsent),
  patientEvent: delegate(createPatientEvent),
};
