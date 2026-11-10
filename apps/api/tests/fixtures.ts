import type {
  ClinicalEpisode,
  InformedConsent,
  InitialEvaluation,
  Patient,
  PatientEvent,
  Prisma,
} from '@prisma/client';
import { EPISODE_SNAPSHOT_VERSION } from '@ficha/shared';
import { prisma } from '../src/lib/prisma';
import { episodeSnapshot } from '../src/repositories/prisma/clinicalSnapshots';
import {
  consentVersionOne,
  episodeVersionOne,
  evaluationVersionOne,
  patientEventVersionOne,
  patientVersionOne,
  revisionFields,
} from '../prisma/versionOne';

// Clinical rows written straight to the database, for tests about what reads
// them. Each comes as the app leaves one: with a SYSTEM audit row of its
// creation and version 1, which is what the revision invariant checks
// (tests/revisionInvariant.ts). Same call shape as the Prisma delegate, so a
// fixture reads like the insert it replaces: `fixture.patient.create({ data })`.
// A `select` is accepted and ignored: the whole row comes back. The version 1
// is written by prisma/versionOne.ts, which the seed uses too.
//
// A test that expects an insert to fail keeps calling Prisma: no row, no version.
// Sessions have their own, createSessionFixture in tests/helpers.ts.

type Tx = Prisma.TransactionClient;

async function createPatient(tx: Tx, data: Prisma.PatientUncheckedCreateInput): Promise<Patient> {
  const row = await tx.patient.create({ data });
  await patientVersionOne(tx, row);
  return row;
}

async function createEpisode(tx: Tx, data: Prisma.ClinicalEpisodeUncheckedCreateInput): Promise<ClinicalEpisode> {
  const row = await tx.clinicalEpisode.create({ data });
  await episodeVersionOne(tx, row);
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
  const { id: auditLogId } = await tx.auditLog.create({
    data: {
      tenantId: row.tenantId,
      patientId: row.patientId,
      entity: 'EPISODE',
      entityId: row.id,
      action: 'EPISODE_UPDATED',
      params: {},
      actorType: 'SYSTEM',
    },
    select: { id: true },
  });
  await tx.episodeRevision.create({
    data: {
      ...revisionFields(row, auditLogId, EPISODE_SNAPSHOT_VERSION, episodeSnapshot(row)),
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
  await evaluationVersionOne(tx, row);
  return row;
}

async function createConsent(tx: Tx, data: Prisma.InformedConsentUncheckedCreateInput): Promise<InformedConsent> {
  const row = await tx.informedConsent.create({ data });
  await consentVersionOne(tx, row);
  return row;
}

async function createPatientEvent(tx: Tx, data: Prisma.PatientEventUncheckedCreateInput): Promise<PatientEvent> {
  const row = await tx.patientEvent.create({ data });
  await patientEventVersionOne(tx, row);
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
