import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// POST /api/patients/:id/encounters con payment: sesión, cobro y cierre de
// episodios se crean en una sola transacción. Antes el frontend encadenaba
// varios requests y un fallo intermedio dejaba sesiones sin pago (invisibles
// en Cobros).
describe('creación atómica de sesión con pago', () => {
  let clinicA: TestClinic;
  let userA: User;
  let tokenA: string;

  let patientA: { id: string };
  let episodeA: { id: string };
  let packageA: { id: string };

  const url = () => `/api/patients/${patientA.id}/encounters`;

  function postEncounter(body: Record<string, unknown> = {}) {
    return request(app)
      .post(url())
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ encounterDate: new Date().toISOString(), ...body });
  }

  beforeAll(async () => {
    clinicA = await createTestClinic();
    userA = await clinicA.createUser();
    tokenA = await createTestToken(userA);

    patientA = await fixture.patient.create({
      data: { tenantId: clinicA.tenantId, firstName: 'Paciente', lastName: 'Atómico' },
      select: { id: true },
    });
    episodeA = await fixture.clinicalEpisode.create({
      data: { tenantId: clinicA.tenantId, patientId: patientA.id, mainComplaint: 'Lumbalgia' },
      select: { id: true },
    });
    packageA = await prisma.sessionPackage.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA.id,
        name: 'Paquete atómico',
        totalSessions: 10,
        pricePerSessionCents: 100,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinicA.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // An encounter's blocks (#238) restrict its deletion: they go first.
    await prisma.encounterBlock.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.encounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
  });

  it('crea sesión + pago en un solo request', async () => {
    const res = await postEncounter({
      episodes: [{ episodeId: episodeA.id }],
      payment: { packageId: packageA.id, baseAmountCents: 100, discountCents: 20, notes: 'seña' },
    });

    expect(res.status).toBe(201);
    const encounterId = res.body.data.id;

    const payment = await prisma.payment.findUnique({
      where: { encounterId },
      select: { patientId: true, packageId: true, finalAmountCents: true, status: true },
    });
    expect(payment).toMatchObject({
      patientId: patientA.id,
      packageId: packageA.id,
      status: 'PENDING',
    });
    expect(Number(payment?.finalAmountCents)).toBe(80);
  });

  it('si algo falla dentro de la transacción no queda sesión huérfana', async () => {
    const before = await prisma.encounter.count({ where: { patientId: patientA.id } });

    // The payment's insert fails, with the encounter already created: the
    // rollback must take both rows. Amounts in cents no longer overflow their
    // column, so a trigger makes it fail, only for this test's marker (other
    // test files share the database).
    const marker = `fail-${patientA.id}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced by encounterAtomicCreate.test.ts'; END $$`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_payment BEFORE INSERT ON payments
      FOR EACH ROW WHEN (NEW.notes = '${marker}') EXECUTE FUNCTION test_fail_payment()`);

    try {
      const res = await postEncounter({
        episodes: [{ episodeId: episodeA.id }],
        payment: { baseAmountCents: 10_000, notes: marker },
      });

      expect(res.status).toBeGreaterThanOrEqual(500);
      const after = await prisma.encounter.count({ where: { patientId: patientA.id } });
      expect(after).toBe(before);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER test_fail_payment ON payments');
      await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_payment()');
    }
  });

  it('un alta cierra el episodio en el mismo request', async () => {
    const res = await postEncounter({
      encounterType: 'DISCHARGE',
      episodes: [{ episodeId: episodeA.id }],
    });

    expect(res.status).toBe(201);

    // El cierre ocurre dentro de la transacción: se puede asertar sin waitFor.
    const episode = await prisma.clinicalEpisode.findUnique({
      where: { id: episodeA.id },
      select: { status: true, closedAt: true },
    });
    expect(episode?.status).toBe('DISCHARGED');
    expect(episode?.closedAt).not.toBeNull();
  });

  it('a discharge of an episode that opens later is refused, and nothing is recorded', async () => {
    const openedAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinicA.tenantId, patientId: patientA.id, mainComplaint: 'Cervicalgia', openedAt },
      select: { id: true },
    });
    const encountersBefore = await prisma.encounter.count({ where: { patientId: patientA.id } });

    const res = await postEncounter({ encounterType: 'DISCHARGE', episodes: [{ episodeId: episode.id }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('El episodio abre más adelante: no se puede dar de alta antes de su apertura');
    await expect(
      prisma.clinicalEpisode.findUnique({ where: { id: episode.id }, select: { status: true, closedAt: true } }),
    ).resolves.toEqual({ status: 'ACTIVE', closedAt: null });
    await expect(prisma.encounter.count({ where: { patientId: patientA.id } })).resolves.toBe(encountersBefore);
  });
});
