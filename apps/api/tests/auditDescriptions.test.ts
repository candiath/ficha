import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, type TestClinic } from './helpers';

// An audit description names the action, never a value (#186,
// docs/specs/SPEC-audit-hardening.md §4): audit rows can never change, so a
// pain score, a scale score or an amount copied into one could never be
// corrected or erased. The values live in their own rows.
describe('audit descriptions carry no values', () => {
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
      data: { tenantId: clinic.tenantId, fullName: 'Described Patient' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    const tenantId = clinic.tenantId;
    await deleteAuditRows([tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.functionalScale.deleteMany({ where: { tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId } });
    await clinic.cleanup();
  });

  const descriptionOf = async (entityId: string, action: 'CREATED' | 'UPDATED') =>
    (
      await prisma.auditLog.findFirstOrThrow({
        where: { tenantId: clinic.tenantId, entityId, action },
        select: { description: true },
      })
    ).description;

  async function createSession(body: Record<string, unknown> = {}) {
    const res = await auth(request(app).post(`/api/patients/${patient.id}/sessions`)).send({
      sessionDate: new Date().toISOString(),
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  }

  it('a session with pain values does not record them', async () => {
    const session = await createSession({ painScaleBefore: 7, painScaleAfter: 3 });

    expect(await descriptionOf(session.id, 'CREATED')).toBe('Sesión RPG registrada');
  });

  it('a scale does not record its score', async () => {
    const res = await auth(request(app).post(`/api/patients/${patient.id}/scales`)).send({
      scaleType: 'OSWESTRY',
      responses: { q1: 3, q2: 2, q3: 4, q4: 1, q5: 0 },
    });
    expect(res.status).toBe(201);

    expect(await descriptionOf(res.body.data.id, 'CREATED')).toBe('Escala OSWESTRY aplicada');
  });

  it('a payment does not record its amount', async () => {
    const session = await createSession();
    const res = await auth(request(app).post('/api/payments')).send({
      sessionId: session.id,
      baseAmount: 15000,
    });
    expect(res.status).toBe(201);

    expect(await descriptionOf(res.body.data.id, 'CREATED')).toBe('Cobro registrado');
  });

  // It used to append "— Estado: X" whenever the body carried a status, even
  // the one the payment already had.
  it('a payment update does not claim a status change', async () => {
    const session = await createSession({ payment: { baseAmount: 9000 } });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { sessionId: session.id },
      select: { id: true, status: true },
    });

    const res = await auth(request(app).patch(`/api/payments/${payment.id}`)).send({
      status: payment.status,
    });
    expect(res.status).toBe(200);

    expect(await descriptionOf(payment.id, 'UPDATED')).toBe('Cobro actualizado');
  });
});
