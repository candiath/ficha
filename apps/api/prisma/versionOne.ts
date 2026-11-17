import type {
  AuditAction,
  ClinicalEpisode,
  InformedConsent,
  InitialEvaluation,
  Patient,
  PatientAntecedent,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  auditEntityOf,
  auditEntryProblem,
  CONSENT_SNAPSHOT_VERSION,
  EPISODE_SNAPSHOT_VERSION,
  EVALUATION_SNAPSHOT_VERSION,
  PATIENT_ANTECEDENT_SNAPSHOT_VERSION,
  PATIENT_SNAPSHOT_VERSION,
  ENCOUNTER_SNAPSHOT_VERSION,
} from '@ficha/shared';
import {
  consentSnapshot,
  episodeSnapshot,
  evaluationSnapshot,
  patientAntecedentSnapshot,
  patientSnapshot,
} from '../src/repositories/prisma/clinicalSnapshots';
import { encounterSnapshot } from '../src/repositories/prisma/encounterSnapshot';

// Version 1 of a clinical aggregate written straight to the database, by the
// seed and the test fixtures (tests/fixtures.ts): a SYSTEM audit row of its
// creation, since no user wrote it, and a revision equal to its rows
// (SPEC-clinical-revisions.md §9, checked by tests/revisionInvariant.ts). The
// caller passes the transaction that wrote the rows.
//
// If the clinic's history already records the creation (the seed's demo rows,
// written by a user on a past date), version 1 points at that row instead of
// adding a second creation. Version 1 is the row's current state under its
// creation action: a closed episode or a revoked consent is not rebuilt as
// version 1 open plus version 2 closed, as the app would leave it.

type Tx = Prisma.TransactionClient;

interface Owned {
  tenantId: string;
  patientId: string;
  id: string;
}

// Checked against the catalog like every other audit write (recordAudit, and
// the seed's own rows): the entity comes from the action.
async function auditRow(tx: Tx, row: Owned, action: AuditAction, params: Prisma.InputJsonValue) {
  const problem = auditEntryProblem('audit_logs', action, params);
  const entity = auditEntityOf('audit_logs', action);
  if (problem || !entity) throw new Error(`versionOne: ${problem ?? `no entity for ${action}`}`);
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

// The row that records the aggregate's creation: the earliest one already in
// its history, or a new SYSTEM one.
async function creationRow(tx: Tx, row: Owned, action: AuditAction, params: Prisma.InputJsonValue) {
  const existing = await tx.auditLog.findFirst({
    where: { tenantId: row.tenantId, patientId: row.patientId, entityId: row.id, action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return existing?.id ?? auditRow(tx, row, action, params);
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
  const auditLogId = await creationRow(tx, owned, 'PATIENT_CREATED', {});
  await tx.patientRevision.create({
    data: revisionFields(owned, auditLogId, PATIENT_SNAPSHOT_VERSION, patientSnapshot(row)),
  });
}

export async function episodeVersionOne(tx: Tx, row: ClinicalEpisode): Promise<void> {
  const auditLogId = await creationRow(tx, row, 'EPISODE_OPENED', {});
  await tx.episodeRevision.create({
    data: { ...revisionFields(row, auditLogId, EPISODE_SNAPSHOT_VERSION, episodeSnapshot(row)), episodeId: row.id },
  });
}

export async function evaluationVersionOne(tx: Tx, row: InitialEvaluation): Promise<void> {
  const auditLogId = await creationRow(tx, row, 'EVALUATION_CREATED', {});
  await tx.evaluationRevision.create({
    data: {
      ...revisionFields(row, auditLogId, EVALUATION_SNAPSHOT_VERSION, evaluationSnapshot(row)),
      evaluationId: row.id,
    },
  });
}

export async function consentVersionOne(tx: Tx, row: InformedConsent): Promise<void> {
  const auditLogId = await creationRow(tx, row, 'CONSENT_SIGNED', {});
  await tx.consentRevision.create({
    data: { ...revisionFields(row, auditLogId, CONSENT_SNAPSHOT_VERSION, consentSnapshot(row)), consentId: row.id },
  });
}

export async function patientAntecedentVersionOne(tx: Tx, row: PatientAntecedent): Promise<void> {
  const auditLogId = await creationRow(tx, row, 'PATIENT_ANTECEDENT_RECORDED', { kind: row.kind });
  await tx.patientAntecedentRevision.create({
    data: {
      ...revisionFields(row, auditLogId, PATIENT_ANTECEDENT_SNAPSHOT_VERSION, patientAntecedentSnapshot(row)),
      patientAntecedentId: row.id,
    },
  });
}

// The columns an encounter's snapshot is built from, blocks included.
export const encounterSnapshotSelect = {
  id: true,
  tenantId: true,
  patientId: true,
  userId: true,
  encounterType: true,
  encounterDate: true,
  observations: true,
  episodes: { orderBy: { episodeId: 'asc' } },
} as const satisfies Prisma.EncounterSelect;

type EncounterRows = Prisma.EncounterGetPayload<{ select: typeof encounterSnapshotSelect }>;

const ENCOUNTER_CREATED = { SESSION: 'ENCOUNTER_RECORDED', NOTE: 'NOTE_RECORDED', DISCHARGE: 'DISCHARGE_RECORDED' } as const;

export async function encounterVersionOne(tx: Tx, row: EncounterRows): Promise<void> {
  const auditLogId = await creationRow(tx, row, ENCOUNTER_CREATED[row.encounterType], {});
  await tx.encounterRevision.create({
    data: { ...revisionFields(row, auditLogId, ENCOUNTER_SNAPSHOT_VERSION, encounterSnapshot(row)), encounterId: row.id },
  });
}

// Gives version 1 to every clinical aggregate of the clinic that has no
// revision yet, one transaction each, reading its rows inside it; patients
// first, since a patient's version comes before the rest. One after another:
// the seed's client waits 2 s for a connection, and a few dozen transactions
// at once can exceed it. Version 1 is written once: a second run finds nothing
// to do. Returns how many aggregates it versioned.
export async function versionUnversioned(prisma: PrismaClient, tenantId: string): Promise<number> {
  const unversioned = { tenantId, revisions: { none: {} } };
  const pick = { select: { id: true }, orderBy: { id: 'asc' } } as const;
  const steps: [{ id: string }[], (tx: Tx, id: string) => Promise<void>][] = [
    [
      await prisma.patient.findMany({ where: unversioned, ...pick }),
      async (tx, id) => patientVersionOne(tx, await tx.patient.findUniqueOrThrow({ where: { id } })),
    ],
    [
      await prisma.clinicalEpisode.findMany({ where: unversioned, ...pick }),
      async (tx, id) => episodeVersionOne(tx, await tx.clinicalEpisode.findUniqueOrThrow({ where: { id } })),
    ],
    [
      await prisma.initialEvaluation.findMany({ where: unversioned, ...pick }),
      async (tx, id) => evaluationVersionOne(tx, await tx.initialEvaluation.findUniqueOrThrow({ where: { id } })),
    ],
    [
      await prisma.informedConsent.findMany({ where: unversioned, ...pick }),
      async (tx, id) => consentVersionOne(tx, await tx.informedConsent.findUniqueOrThrow({ where: { id } })),
    ],
    [
      await prisma.patientAntecedent.findMany({ where: unversioned, ...pick }),
      async (tx, id) => patientAntecedentVersionOne(tx, await tx.patientAntecedent.findUniqueOrThrow({ where: { id } })),
    ],
    [
      await prisma.encounter.findMany({ where: unversioned, ...pick }),
      async (tx, id) =>
        encounterVersionOne(tx, await tx.encounter.findUniqueOrThrow({ where: { id }, select: encounterSnapshotSelect })),
    ],
  ];

  let count = 0;
  for (const [ids, write] of steps) {
    for (const { id } of ids) {
      await prisma.$transaction((tx) => write(tx, id));
      count += 1;
    }
  }
  return count;
}
