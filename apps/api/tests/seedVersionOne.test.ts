import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.informedConsent.deleteMany({ where });
    await prisma.initialEvaluation.deleteMany({ where });
    await prisma.patientEvent.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('gives every unversioned aggregate a SYSTEM version 1 equal to its rows, once', async () => {
    const tenantId = clinic.tenantId;
    const user = await clinic.createUser();
    const patient = await prisma.patient.create({ data: { tenantId, firstName: 'Sem', lastName: 'Brado' } });
    const owner = { tenantId, patientId: patient.id };
    const episode = await prisma.clinicalEpisode.create({ data: { ...owner, mainComplaint: 'Lumbalgia' } });
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

    expect(await versionUnversioned(prisma, tenantId)).toBe(6);
    await assertRevisionInvariant();

    const audit = await prisma.auditLog.findMany({ where: { tenantId }, select: { entityId: true, actorType: true } });
    expect(new Set(audit.map((a) => a.entityId))).toEqual(
      new Set([patient.id, episode.id, evaluation.id, consent.id, event.id, session.id]),
    );
    expect(audit.every((a) => a.actorType === 'SYSTEM')).toBe(true);

    // A second run of the seed writes nothing.
    expect(await versionUnversioned(prisma, tenantId)).toBe(0);
    expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(6);
  });
});
