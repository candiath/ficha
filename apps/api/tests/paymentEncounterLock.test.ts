import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createEncounterFixture, createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// Creating a payment and deleting (annulling, from #292) its encounter must not
// interleave: the deletion removes the encounter's unpaid payment and marks the
// encounter deleted only if no payment is left, so a payment inserted in between
// would land on a deleted encounter. Both lock the encounter row first, so one
// waits for the other.
describe('payment creation and encounter deletion', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const postPayment = (encounterId: string) =>
    auth(request(app).post('/api/payments')).send({ encounterId, baseAmountCents: 100 });
  // Encounters are annulled, never deleted (#292); annulling marks deleted_at.
  const deleteEncounter = (encounterId: string) =>
    auth(request(app).post(`/api/patients/${patient.id}/encounters/${encounterId}/annul`)).send({
      reason: 'DATA_ENTRY_ERROR',
    });
  const payPayment = (paymentId: string) =>
    auth(request(app).patch(`/api/payments/${paymentId}`)).send({
      status: 'PAID',
      method: 'CASH',
      paidAt: new Date().toISOString(),
    });
  const newEncounter = () =>
    createEncounterFixture({
      tenantId: clinic.tenantId,
      patientId: patient.id,
      userId: user.id,
      encounterDate: new Date(),
    });

  // No payment may hang from a deleted encounter.
  async function paymentsOnDeletedEncounters(): Promise<number> {
    return prisma.payment.count({
      where: { tenantId: clinic.tenantId, encounter: { deletedAt: { not: null } } },
    });
  }

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente Cobro', lastName: 'Anulación' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    // An encounter's blocks (#238) restrict its deletion: they go first.
    await prisma.encounterBlock.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.encounter.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  it('answers 404 and inserts nothing for an encounter already deleted', async () => {
    const encounter = await newEncounter();
    expect((await deleteEncounter(encounter.id)).status).toBe(204);

    const res = await postPayment(encounter.id);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
    expect(await prisma.payment.count({ where: { encounterId: encounter.id } })).toBe(0);
  });

  // The deletion is held open between marking the encounter deleted and its
  // commit, exactly as `annul` does it: lock the encounter, remove
  // its unpaid payment, mark it deleted if no payment is left. A payment
  // created meanwhile must wait for that commit and then find the encounter
  // deleted. Before the fix it did not wait: the insert's foreign key check
  // takes only KEY SHARE on the encounter, which FOR NO KEY UPDATE does not
  // block, so it committed a payment the deletion could no longer see.
  it('waits for a deletion in progress and then answers 404', async () => {
    const encounter = await newEncounter();

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const deletion = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "encounters" WHERE "id" = ${encounter.id}::uuid FOR NO KEY UPDATE`;
        await tx.payment.deleteMany({ where: { encounterId: encounter.id, status: { not: 'PAID' } } });
        const { count } = await tx.encounter.updateMany({
          where: { id: encounter.id, deletedAt: null, payment: { is: null } },
          data: { deletedAt: new Date() },
        });
        expect(count).toBe(1);
        holding();
        await released;
      },
      { timeout: 20_000 },
    );
    await held;

    let done = false;
    const creation = postPayment(encounter.id).then((r) => {
      done = true;
      return r;
    });
    const waiting = async () => {
      const [{ count }] = await prisma.$queryRaw<[{ count: number }]>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      return count;
    };
    for (let i = 0; i < 200 && !done && (await waiting()) < 1; i++) await sleep(25);
    // The creation is blocked on the encounter's lock, not finished.
    expect(done).toBe(false);

    release();
    await deletion;
    const res = await creation;
    expect(res.status).toBe(404);
    expect(await prisma.payment.count({ where: { encounterId: encounter.id } })).toBe(0);
  });

  // A paid payment keeps its encounter: annulling answers 409 and leaves both.
  it('refuses to annul an encounter whose payment is paid', async () => {
    const encounter = await newEncounter();
    const created = await postPayment(encounter.id);
    expect(created.status).toBe(201);
    expect((await payPayment(created.body.data.id)).status).toBe(200);

    const res = await deleteEncounter(encounter.id);
    expect(res.status).toBe(409);
    expect(await prisma.payment.count({ where: { encounterId: encounter.id } })).toBe(1);
    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id }, select: { deletedAt: true } });
    expect(row.deletedAt).toBeNull();
  });

  // Whichever wins, the invariant holds: either the payment exists and the
  // encounter is not annulled, or the encounter is annulled and has no payment.
  // A payment is created pending, and annulling removes a pending one, so a
  // creation racing the annulment always ends with the encounter annulled. The
  // other outcome needs the payment paid first: the odd rounds race paying an
  // existing pending payment against the annulment.
  //
  // Twenty rounds of a dozen queries each outgrow the default 15 s on Neon,
  // where every query crosses the network; a timeout also leaves requests in
  // flight that write audit rows while afterAll deletes them.
  it('never leaves a payment on an annulled encounter under concurrent requests', async () => {
    const outcomes = { annulled: 0, kept: 0 };
    for (let i = 0; i < 20; i++) {
      const encounter = await newEncounter();
      let write: request.Response;
      let annul: request.Response;
      if (i % 2 === 0) {
        [write, annul] = await Promise.all([postPayment(encounter.id), deleteEncounter(encounter.id)]);
      } else {
        const created = await postPayment(encounter.id);
        expect(created.status).toBe(201);
        [write, annul] = await Promise.all([payPayment(created.body.data.id), deleteEncounter(encounter.id)]);
      }

      const payment = await prisma.payment.findUnique({ where: { encounterId: encounter.id } });
      const row = await prisma.encounter.findUniqueOrThrow({
        where: { id: encounter.id },
        select: { deletedAt: true },
      });
      if (row.deletedAt) {
        outcomes.annulled++;
        expect(payment).toBeNull();
        expect(annul.status).toBe(204);
      } else {
        outcomes.kept++;
        expect(payment?.status).toBe('PAID');
        expect(write.status).toBe(200);
        expect(annul.status).toBe(409);
      }
    }
    expect(await paymentsOnDeletedEncounters()).toBe(0);
    expect(outcomes.annulled).toBeGreaterThan(0);
  }, 90_000);
});
