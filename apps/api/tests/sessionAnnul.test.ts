import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// A session entered by mistake is annulled (SPEC-clinical-revisions.md §8),
// with one hard rule: not if it was paid. These tests pin that rule and what
// an annulment reaches: payments, appointments, reading, editing and metrics.
// tests/annulment.test.ts covers the action, its version and the record's list.
describe('annulling a session', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const sessionsUrl = () => `/api/patients/${patient.id}/sessions`;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Annulled', lastName: 'Session' },
      select: { id: true },
    });
    // Every session treats an episode (#238).
    episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Creates a session through the API and returns its id. */
  async function createSession(payment?: { baseAmountCents: number; discountCents?: number }) {
    const res = await auth(request(app).post(sessionsUrl())).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id }],
      observations: 'Test session',
      ...(payment ? { payment } : {}),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function annul(sessionId: string) {
    return auth(request(app).post(`${sessionsUrl()}/${sessionId}/annul`)).send({ reason: 'DATA_ENTRY_ERROR' });
  }

  // What the annulment's audit row says happened to the payment.
  async function annulledPayment(sessionId: string) {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId: sessionId, action: 'SESSION_ANNULLED' } });
    return (row.params as { payment: string }).payment;
  }

  async function paymentOf(sessionId: string) {
    const res = await auth(request(app).get(`/api/payments?patientId=${patient.id}`));
    return res.body.data.find((p: { sessionId: string }) => p.sessionId === sessionId);
  }

  it('annuls a session with no payment: the row stays, marked', async () => {
    const id = await createSession();

    expect((await annul(id)).status).toBe(204);

    const row = await prisma.session.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(await annulledPayment(id)).toBe('NONE');
  });

  it('takes its pending payment: no charge is left for a visit that did not happen', async () => {
    const id = await createSession({ baseAmountCents: 15000 });
    expect(await paymentOf(id)).toBeDefined();

    expect((await annul(id)).status).toBe(204);

    // Deleted for real: no money came in, so it is not history. The
    // annulment's audit row is its trace.
    expect(await paymentOf(id)).toBeUndefined();
    expect(await prisma.payment.findFirst({ where: { sessionId: id } })).toBeNull();
    expect(await annulledPayment(id)).toBe('PENDING_DELETED');
  });

  it('answers 409 to a paid session and changes nothing', async () => {
    const id = await createSession({ baseAmountCents: 20000 });
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

    // Neither the session nor the payment changed, and nothing was recorded.
    expect((await prisma.session.findUnique({ where: { id } }))?.deletedAt).toBeNull();
    expect(await paymentOf(id)).toBeDefined();
    expect(await prisma.auditLog.count({ where: { tenantId: clinic.tenantId } })).toBe(before);
    expect(await prisma.sessionRevision.count({ where: { sessionId: id } })).toBe(1);
  });

  it('a waived session can be annulled: no money came in', async () => {
    const id = await createSession({ baseAmountCents: 9000 });
    const payment = await paymentOf(id);
    await auth(request(app).patch(`/api/payments/${payment.id}`)).send({ status: 'WAIVED' });

    expect((await annul(id)).status).toBe(204);
    expect(await paymentOf(id)).toBeUndefined();
    expect(await annulledPayment(id)).toBe('WAIVED_DELETED');
  });

  it('an annulled session cannot be read alone, edited or annulled again', async () => {
    const id = await createSession();
    expect((await annul(id)).status).toBe(204);

    expect((await auth(request(app).get(`${sessionsUrl()}/${id}`))).status).toBe(404);

    const edited = await auth(request(app).patch(`${sessionsUrl()}/${id}`)).send({
      reason: 'DATA_ENTRY_ERROR',
      observations: 'should not land',
    });
    expect(edited.status).toBe(404);

    expect((await annul(id)).status).toBe(404);
  });

  // A payment created at the very moment of an annulment can still land on the
  // session (payments do not lock it). Annulling it again must not delete it.
  it('a second annulment answers 404 and leaves a payment on the session alone', async () => {
    const id = await createSession();
    expect((await annul(id)).status).toBe(204);
    await prisma.payment.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, sessionId: id, baseAmountCents: 1000, finalAmountCents: 1000, status: 'PENDING' },
    });

    expect((await annul(id)).status).toBe(404);
    expect(await prisma.payment.findFirst({ where: { sessionId: id } })).not.toBeNull();
    await prisma.payment.deleteMany({ where: { sessionId: id } });
  });

  it('answers 404 to a session that does not exist', async () => {
    const res = await annul(randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });

  // The pending payment used to be deleted by session id alone, before the
  // session's own write checked the patient: a session of another patient, sent
  // under this patient's URL, answered 404 and still lost its payment.
  it("answers 404 to another patient's session and leaves its payment alone", async () => {
    const other = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Otra', lastName: 'Paciente' },
      select: { id: true },
    });
    const otherEpisode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: other.id },
      select: { id: true },
    });
    const created = await auth(request(app).post(`/api/patients/${other.id}/sessions`)).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: otherEpisode.id }],
      payment: { baseAmountCents: 12000 },
    });
    expect(created.status).toBe(201);
    const otherSessionId = created.body.data.id as string;

    const res = await annul(otherSessionId);

    expect(res.status).toBe(404);
    expect(await prisma.payment.findFirst({ where: { sessionId: otherSessionId } })).not.toBeNull();
    expect((await prisma.session.findUnique({ where: { id: otherSessionId } }))?.deletedAt).toBeNull();
  });

  it('stops counting in the dashboard metrics', async () => {
    const before = await auth(request(app).get('/api/dashboard/stats'));
    const totalBefore = before.body.data.totalSessions as number;

    const id = await createSession();
    const withIt = await auth(request(app).get('/api/dashboard/stats'));
    expect(withIt.body.data.totalSessions).toBe(totalBefore + 1);

    expect((await annul(id)).status).toBe(204);

    const after = await auth(request(app).get('/api/dashboard/stats'));
    expect(after.body.data.totalSessions).toBe(totalBefore);
  });
});
