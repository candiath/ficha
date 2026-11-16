import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// An encounter entered by mistake is annulled (SPEC-clinical-revisions.md §8),
// with one hard rule: not if it was paid. These tests pin that rule and what
// an annulment reaches: payments, appointments, reading, editing and metrics.
// tests/annulment.test.ts covers the action, its version and the record's list.
describe('annulling an encounter', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const encountersUrl = () => `/api/patients/${patient.id}/encounters`;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Annulled', lastName: 'Encounter' },
      select: { id: true },
    });
    // Every encounter treats an episode (#238).
    episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    // An encounter's blocks (#238) restrict its deletion: they go first.
    await prisma.encounterBlock.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.encounter.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Creates an encounter through the API and returns its id. */
  async function createEncounter(payment?: { baseAmountCents: number; discountCents?: number }) {
    const res = await auth(request(app).post(encountersUrl())).send({
      encounterDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id }],
      observations: 'Test encounter',
      ...(payment ? { payment } : {}),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function annul(encounterId: string) {
    return auth(request(app).post(`${encountersUrl()}/${encounterId}/annul`)).send({ reason: 'DATA_ENTRY_ERROR' });
  }

  // What the annulment's audit row says happened to the payment.
  async function annulledPayment(encounterId: string) {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: encounterId, action: 'ENCOUNTER_ANNULLED' } });
    return (row.params as { payment: string }).payment;
  }

  async function paymentOf(encounterId: string) {
    const res = await auth(request(app).get(`/api/payments?patientId=${patient.id}`));
    return res.body.data.find((p: { encounterId: string }) => p.encounterId === encounterId);
  }

  it('annuls an encounter with no payment: the row stays, marked', async () => {
    const id = await createEncounter();

    expect((await annul(id)).status).toBe(204);

    const row = await prisma.encounter.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(await annulledPayment(id)).toBe('NONE');
  });

  it('takes its pending payment: no charge is left for a visit that did not happen', async () => {
    const id = await createEncounter({ baseAmountCents: 15000 });
    expect(await paymentOf(id)).toBeDefined();

    expect((await annul(id)).status).toBe(204);

    // Deleted for real: no money came in, so it is not history. The
    // annulment's audit row is its trace.
    expect(await paymentOf(id)).toBeUndefined();
    expect(await prisma.payment.findFirst({ where: { encounterId: id } })).toBeNull();
    expect(await annulledPayment(id)).toBe('PENDING_DELETED');
  });

  it('answers 409 to a paid encounter and changes nothing', async () => {
    const id = await createEncounter({ baseAmountCents: 20000 });
    const payment = await paymentOf(id);

    const paid = await auth(request(app).patch(`/api/payments/${payment.id}`)).send({
      status: 'PAID',
      method: 'CASH',
    });
    expect(paid.status).toBe(200);
    const before = await prisma.auditLog.count({ where: { tenantId: clinic.tenantId } });

    const res = await annul(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cobro/i);

    // Neither the encounter nor the payment changed, and nothing was recorded.
    expect((await prisma.encounter.findUnique({ where: { id } }))?.deletedAt).toBeNull();
    expect(await paymentOf(id)).toBeDefined();
    expect(await prisma.auditLog.count({ where: { tenantId: clinic.tenantId } })).toBe(before);
    expect(await prisma.encounterRevision.count({ where: { encounterId: id } })).toBe(1);
  });

  it('a waived encounter can be annulled: no money came in', async () => {
    const id = await createEncounter({ baseAmountCents: 9000 });
    const payment = await paymentOf(id);
    await auth(request(app).patch(`/api/payments/${payment.id}`)).send({ status: 'WAIVED' });

    expect((await annul(id)).status).toBe(204);
    expect(await paymentOf(id)).toBeUndefined();
    expect(await annulledPayment(id)).toBe('WAIVED_DELETED');
  });

  it('an annulled encounter cannot be read alone, edited or annulled again', async () => {
    const id = await createEncounter();
    expect((await annul(id)).status).toBe(204);

    expect((await auth(request(app).get(`${encountersUrl()}/${id}`))).status).toBe(404);

    const edited = await auth(request(app).patch(`${encountersUrl()}/${id}`)).send({
      reason: 'DATA_ENTRY_ERROR',
      observations: 'should not land',
    });
    expect(edited.status).toBe(404);

    expect((await annul(id)).status).toBe(404);
  });

  // A payment created at the very moment of an annulment can still land on the
  // encounter (payments do not lock it). Annulling it again must not delete it.
  it('a second annulment answers 404 and leaves a payment on the encounter alone', async () => {
    const id = await createEncounter();
    expect((await annul(id)).status).toBe(204);
    await prisma.payment.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, encounterId: id, baseAmountCents: 1000, finalAmountCents: 1000, status: 'PENDING' },
    });

    expect((await annul(id)).status).toBe(404);
    expect(await prisma.payment.findFirst({ where: { encounterId: id } })).not.toBeNull();
    await prisma.payment.deleteMany({ where: { encounterId: id } });
  });

  it('answers 404 to an encounter that does not exist', async () => {
    const res = await annul(randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });

  // The pending payment used to be deleted by encounter id alone, before the
  // encounter's own write checked the patient: an encounter of another patient, sent
  // under this patient's URL, answered 404 and still lost its payment.
  it("answers 404 to another patient's encounter and leaves its payment alone", async () => {
    const other = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Otra', lastName: 'Paciente' },
      select: { id: true },
    });
    const otherEpisode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: other.id },
      select: { id: true },
    });
    const created = await auth(request(app).post(`/api/patients/${other.id}/encounters`)).send({
      encounterDate: new Date().toISOString(),
      episodes: [{ episodeId: otherEpisode.id }],
      payment: { baseAmountCents: 12000 },
    });
    expect(created.status).toBe(201);
    const otherEncounterId = created.body.data.id as string;

    const res = await annul(otherEncounterId);

    expect(res.status).toBe(404);
    expect(await prisma.payment.findFirst({ where: { encounterId: otherEncounterId } })).not.toBeNull();
    expect((await prisma.encounter.findUnique({ where: { id: otherEncounterId } }))?.deletedAt).toBeNull();
  });

  it('stops counting in the dashboard metrics', async () => {
    const before = await auth(request(app).get('/api/dashboard/stats'));
    const totalBefore = before.body.data.totalEncounters as number;

    const id = await createEncounter();
    const withIt = await auth(request(app).get('/api/dashboard/stats'));
    expect(withIt.body.data.totalEncounters).toBe(totalBefore + 1);

    expect((await annul(id)).status).toBe(204);

    const after = await auth(request(app).get('/api/dashboard/stats'));
    expect(after.body.data.totalEncounters).toBe(totalBefore);
  });
});
