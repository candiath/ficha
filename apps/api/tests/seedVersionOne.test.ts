import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditEntityOf, auditEntryProblem } from '@ficha/shared';
import { prisma } from '../src/lib/prisma';
import { versionUnversioned } from '../prisma/versionOne';
import { createTestClinic, deleteAuditRows, type TestClinic } from './helpers';
import { assertRevisionInvariant } from './revisionInvariant';

// The seed writes its rows with plain upserts and then gives every clinical
// aggregate version 1 with versionUnversioned (prisma/seed.ts). Rows inserted
// here the same way stand in for the seed's; the revision invariant that runs
// after each test (tests/setup.ts) is the check the seed must pass.
describe('versionUnversioned (the seed’s version 1)', () => {
  let clinic: TestClinic;
  let other: TestClinic;

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
  });

  afterAll(async () => {
    for (const c of [clinic, other]) {
      const tenantId = c.tenantId;
      const where = { tenantId };
      await deleteAuditRows([tenantId]);
      await prisma.sessionEpisode.deleteMany({ where });
      await prisma.session.deleteMany({ where });
      await prisma.informedConsent.deleteMany({ where });
      await prisma.initialEvaluation.deleteMany({ where });
      await prisma.patientEvent.deleteMany({ where });
      await prisma.clinicalEpisode.deleteMany({ where });
      await prisma.patient.deleteMany({ where });
      await c.cleanup();
    }
  });

  it('gives every unversioned aggregate version 1 equal to its rows, once, and only in its clinic', async () => {
    const tenantId = clinic.tenantId;
    const user = await clinic.createUser();
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Sem', lastName: 'Brado' } });
    const owner = { tenantId, patientId: patient.id };
    const episode = await prisma.clinicalEpisode.create({ data: { ...owner, mainComplaint: 'Lumbalgia' } });
    const second = await prisma.clinicalEpisode.create({ data: { ...owner, mainComplaint: 'Cervicalgia' } });
    const evaluation = await prisma.initialEvaluation.create({ data: { ...owner, episodeId: episode.id } });
    const consent = await prisma.informedConsent.create({ data: { ...owner, signedAt: new Date() } });
    const event = await prisma.patientEvent.create({ data: { ...owner, kind: 'SURGERY', description: 'Cesárea' } });
    const session = await prisma.session.create({
      data: {
        ...owner,
        userId: user.id,
        sessionDate: new Date(),
        episodes: { create: [{ episodeId: episode.id, treatment: 'Movilización' }] },
      },
    });
    // Two blocks, the later episode first: the snapshot orders them.
    const discharge = await prisma.session.create({
      data: {
        ...owner,
        userId: user.id,
        sessionType: 'DISCHARGE',
        sessionDate: new Date(),
        episodes: {
          create: [
            { episodeId: second.id, treatment: 'Alta' },
            { episodeId: episode.id, treatment: 'Alta' },
          ],
        },
      },
    });

    // Another clinic's unversioned patient is left alone.
    const foreign = await prisma.patient.create({
      data: { tenantId: other.tenantId, firstName: 'Otra', lastName: 'Clínica' },
    });

    expect(await versionUnversioned(prisma, tenantId)).toBe(8);
    expect(await prisma.patientRevision.count({ where: { patientId: foreign.id } })).toBe(0);

    const audit = await prisma.auditLog.findMany({
      where: { tenantId },
      select: { id: true, entity: true, entityId: true, action: true, params: true, actorType: true },
    });
    expect(new Set(audit.map((a) => a.entityId))).toEqual(
      new Set([patient.id, episode.id, second.id, evaluation.id, consent.id, event.id, session.id, discharge.id]),
    );
    for (const row of audit) {
      expect(row.actorType).toBe('SYSTEM');
      expect(auditEntryProblem('audit_logs', row.action, row.params)).toBeNull();
      expect(row.entity).toBe(auditEntityOf('audit_logs', row.action));
    }
    expect(audit.find((a) => a.entityId === discharge.id)?.action).toBe('DISCHARGE_RECORDED');

    // Each revision points at its own aggregate's audit row.
    const byId = new Map(audit.map((a) => [a.id, a.entityId]));
    const revision = await prisma.sessionRevision.findFirstOrThrow({ where: { sessionId: discharge.id } });
    expect(byId.get(revision.auditLogId)).toBe(discharge.id);

    // A second run of the seed writes nothing.
    expect(await versionUnversioned(prisma, tenantId)).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(8);

    // The other clinic, versioned too, so the invariant after the test holds.
    expect(await versionUnversioned(prisma, other.tenantId)).toBe(1);
    await assertRevisionInvariant();
  });

  it('points version 1 at the creation row the history already has, instead of adding one', async () => {
    const tenantId = clinic.tenantId;
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Con', lastName: 'Historia' } });
    const existing = await prisma.auditLog.create({
      data: {
        tenantId,
        patientId: patient.id,
        entity: 'PATIENT',
        entityId: patient.id,
        action: 'PATIENT_CREATED',
        params: {},
        actorType: 'SYSTEM',
      },
    });

    expect(await versionUnversioned(prisma, tenantId)).toBe(1);

    const rows = await prisma.auditLog.findMany({ where: { tenantId, entityId: patient.id } });
    expect(rows.map((r) => r.id)).toEqual([existing.id]);
    const revision = await prisma.patientRevision.findFirstOrThrow({ where: { patientId: patient.id } });
    expect(revision.auditLogId).toBe(existing.id);
  });
});
