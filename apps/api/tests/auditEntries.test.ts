import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditAction, User } from '@prisma/client';
import { describeAuditEntry } from '@ficha/shared';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, type TestClinic } from './helpers';

// Audit rows record what happened as codes (#186,
// docs/specs/SPEC-audit-structured-entries.md): one action per fact, and
// params that are codes only. No pain score, scale score, amount or other
// value ever reaches one: audit rows can never change, so a value copied into
// one could never be corrected or erased. An update records which fields
// changed (names only), and one that changes nothing records nothing.
describe('audit rows record codes, never values', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Coded', lastName: 'Patient' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    const tenantId = clinic.tenantId;
    await deleteAuditRows([tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId } });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.initialEvaluation.deleteMany({ where: { tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId } });
    await prisma.informedConsent.deleteMany({ where: { tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId } });
    await clinic.cleanup();
  });

  // The rows an entity has, oldest first.
  const rowsOf = (entityId: string) =>
    prisma.auditLog.findMany({
      where: { tenantId: clinic.tenantId, entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, params: true, actorType: true, userId: true },
    });

  const actionsOf = async (entityId: string): Promise<{ action: AuditAction; params: unknown }[]> =>
    (await rowsOf(entityId)).map(({ action, params }) => ({ action, params }));

  // Each session treats an episode of its own (#238), with `block` as its
  // block: a discharge closes that episode and no other.
  async function createSession(body: Record<string, unknown> = {}, block: Record<string, unknown> = {}) {
    const episode = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
      select: { id: true },
    });
    const res = await auth(request(app).post(`/api/patients/${patient.id}/sessions`)).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id, ...block }],
      ...body,
    });
    expect(res.status).toBe(201);
    return { ...(res.body.data as { id: string }), episodeId: episode.id };
  }

  it('a session with pain values records its action and nothing else', async () => {
    const session = await createSession({}, { painScaleBefore: 7, painScaleAfter: 3 });

    expect(await rowsOf(session.id)).toEqual([
      { action: 'SESSION_RECORDED', params: {}, actorType: 'USER', userId: user.id },
    ]);
  });

  it('a clinical note and a discharge are actions of their own', async () => {
    const note = await createSession({ sessionType: 'NOTE' });
    const discharge = await createSession({ sessionType: 'DISCHARGE' });

    expect(await actionsOf(note.id)).toEqual([{ action: 'NOTE_RECORDED', params: {} }]);
    expect(await actionsOf(discharge.id)).toEqual([{ action: 'DISCHARGE_RECORDED', params: {} }]);
  });

  it('a session update names the fields it changed, and its type after the change', async () => {
    const session = await createSession({}, { painScaleAfter: 3 });

    const res = await auth(request(app).patch(`/api/patients/${patient.id}/sessions/${session.id}`)).send({
      sessionType: 'DISCHARGE',
      episodes: [{ episodeId: session.episodeId, painScaleAfter: 1 }],
      observations: null,
    });
    expect(res.status).toBe(200);

    expect(await actionsOf(session.id)).toEqual([
      { action: 'SESSION_RECORDED', params: {} },
      // observations was already empty: not a change.
      {
        action: 'SESSION_UPDATED',
        params: { sessionType: 'DISCHARGE', changedFields: ['sessionType', 'painScaleAfter'] },
      },
    ]);
  });

  it('a payment records its status, not its amount', async () => {
    const session = await createSession();
    const res = await auth(request(app).post('/api/payments')).send({
      sessionId: session.id,
      baseAmountCents: 15000,
    });
    expect(res.status).toBe(201);

    expect(await actionsOf(res.body.data.id)).toEqual([
      { action: 'PAYMENT_CREATED', params: { status: 'PENDING' } },
    ]);
  });

  it('a payment update names what changed and the status it was left in', async () => {
    const session = await createSession({ payment: { baseAmountCents: 9000 } });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { sessionId: session.id },
      select: { id: true },
    });

    const res = await auth(request(app).patch(`/api/payments/${payment.id}`)).send({
      status: 'PAID',
      method: 'CASH',
    });
    expect(res.status).toBe(200);

    expect(await actionsOf(payment.id)).toEqual([
      {
        action: 'PAYMENT_UPDATED',
        params: { status: 'PAID', changedFields: ['status', 'method', 'paidAt'] },
      },
    ]);
  });

  // It used to record "Cobro actualizado" whenever the body carried a status,
  // even the one the payment already had.
  it('an update that changes nothing records nothing', async () => {
    const session = await createSession({ payment: { baseAmountCents: 9000 } });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { sessionId: session.id },
      select: { id: true, status: true },
    });

    const samePayment = await auth(request(app).patch(`/api/payments/${payment.id}`)).send({
      status: payment.status,
    });
    const samePatient = await auth(request(app).patch(`/api/patients/${patient.id}`)).send({
      firstName: 'Coded', lastName: 'Patient',
    });
    expect(samePayment.status).toBe(200);
    expect(samePatient.status).toBe(200);

    expect(await actionsOf(payment.id)).toEqual([]);
    expect((await actionsOf(patient.id)).filter((r) => r.action === 'PATIENT_UPDATED')).toEqual([]);
  });

  it('a patient update names the fields it changed, never their values', async () => {
    const res = await auth(request(app).patch(`/api/patients/${patient.id}`)).send({
      phone: '11 5555-0000',
      insuranceName: 'OSDE',
      occupation: null,
    });
    expect(res.status).toBe(200);

    const updates = (await actionsOf(patient.id)).filter((r) => r.action === 'PATIENT_UPDATED');
    expect(updates).toEqual([
      { action: 'PATIENT_UPDATED', params: { changedFields: ['phone', 'insuranceName'] } },
    ]);
    expect(JSON.stringify(updates)).not.toContain('5555');
  });

  it('an evaluation is recorded when created, and by field when corrected', async () => {
    const episode = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Coded complaint' },
      select: { id: true },
    });
    const url = `/api/patients/${patient.id}/episodes/${episode.id}/evaluation`;

    const created = await auth(request(app).put(url)).send({ evaScale: 6, notes: 'Primera' });
    await auth(request(app).put(url)).send({ evaScale: 4, notes: 'Primera' });
    await auth(request(app).put(url)).send({ evaScale: 4, notes: 'Primera' });

    expect(await actionsOf(created.body.data.id)).toEqual([
      { action: 'EVALUATION_CREATED', params: {} },
      { action: 'EVALUATION_UPDATED', params: { changedFields: ['evaScale'] } },
    ]);
  });

  it('signing and revoking a consent are two different actions', async () => {
    await auth(request(app).post(`/api/patients/${patient.id}/consent`)).send({});
    const revoked = await auth(request(app).delete(`/api/patients/${patient.id}/consent`));
    expect(revoked.status).toBe(200);

    const consent = await prisma.informedConsent.findFirstOrThrow({
      where: { patientId: patient.id },
      select: { id: true },
    });
    expect(await actionsOf(consent.id)).toEqual([
      { action: 'CONSENT_SIGNED', params: {} },
      { action: 'CONSENT_REVOKED', params: {} },
    ]);
  });

  it("the patient's history carries codes, which the catalog turns into a sentence", async () => {
    const res = await auth(request(app).get(`/api/patients/${patient.id}/audit-log`));
    expect(res.status).toBe(200);

    const update = (res.body.data as { action: string; params: unknown }[]).find(
      (e) => e.action === 'PATIENT_UPDATED',
    );
    expect(update).toMatchObject({ params: { changedFields: ['phone', 'insuranceName'] } });
    expect(update).not.toHaveProperty('description');
    expect(describeAuditEntry('audit_logs', update!.action, update!.params)).toBe(
      'Actualizó el teléfono y la obra social',
    );
  });
});
