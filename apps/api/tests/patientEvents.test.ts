import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';

// The patient's history ("Antecedentes", #238): what she lived, as dated facts.
// It belongs to the patient, and its date is partial (a day, a month, a year,
// maybe approximate), stored truncated so it never ages.
describe('The patient history', () => {
  let clinic: TestClinic;
  let clinicB: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let otherPatient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (patientId = patient.id) => `/api/patients/${patientId}/events`;
  const post = (body: Record<string, unknown>, patientId = patient.id) =>
    auth(request(app).post(url(patientId))).send(body);

  const fracture = {
    kind: 'FRACTURE',
    description: 'Fractura de muñeca izquierda',
    occurred: { date: '2019-01-01', precision: 'YEAR', approximate: false },
  };

  beforeAll(async () => {
    clinic = await createTestClinic();
    clinicB = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Con antecedentes' },
      select: { id: true },
    });
    otherPatient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Otro paciente' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinic.tenantId, clinicB.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.patientEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await clinicB.cleanup();
  });

  it('records an event with a partial date and returns it as written', async () => {
    const res = await post(fracture);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      id: expect.any(String),
      patientId: patient.id,
      kind: 'FRACTURE',
      description: 'Fractura de muñeca izquierda',
      occurred: { date: '2019-01-01', precision: 'YEAR', approximate: false },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });

  it('records an event with no date when the patient does not know when', async () => {
    const res = await post({ kind: 'TRAUMA', description: 'Accidente de auto', occurred: null });

    expect(res.status).toBe(201);
    expect(res.body.data.occurred).toBeNull();
  });

  it('lists dated events newest first and undated ones last', async () => {
    const own = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Orden' },
      select: { id: true },
    });
    const old = (await post({ ...fracture, description: 'Vieja' }, own.id)).body.data.id;
    const undated = (await post({ kind: 'OTHER', description: 'Sin fecha', occurred: null }, own.id)).body.data.id;
    const recent = (
      await post(
        {
          kind: 'PAIN_ONSET',
          description: 'Dolor lumbar',
          occurred: { date: '2025-08-01', precision: 'MONTH', approximate: true },
        },
        own.id,
      )
    ).body.data.id;

    const res = await auth(request(app).get(url(own.id)));
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual([recent, old, undated]);
  });

  it('refuses a date with more detail than its precision, an impossible date and a future one', async () => {
    for (const occurred of [
      { date: '2024-03-15', precision: 'MONTH', approximate: false },
      { date: '2024-06-01', precision: 'YEAR', approximate: false },
      { date: '2023-02-30', precision: 'DAY', approximate: false },
      { date: '2099-01-01', precision: 'YEAR', approximate: false },
    ]) {
      const res = await post({ ...fracture, occurred });
      expect(res.status, JSON.stringify(occurred)).toBe(400);
    }
  });

  it('refuses an event without a description or with an unknown kind', async () => {
    expect((await post({ ...fracture, description: '   ' })).status).toBe(400);
    expect((await post({ ...fracture, kind: 'POSTURE' })).status).toBe(400);
  });

  // The CHECKs behind the API: a write that skips it still cannot store a
  // month as the 15th or an approximate event without a date.
  it('is checked by the database too', async () => {
    const base = { tenantId: clinic.tenantId, patientId: patient.id, kind: 'OTHER' as const, description: 'Directo' };
    await expect(
      prisma.patientEvent.create({
        data: { ...base, occurredOn: new Date('2024-03-15T00:00:00.000Z'), occurredPrecision: 'MONTH' },
      }),
    ).rejects.toThrow();
    await expect(prisma.patientEvent.create({ data: { ...base, occurredApproximate: true } })).rejects.toThrow();
    await expect(
      prisma.patientEvent.create({ data: { ...base, occurredOn: new Date('2024-03-01T00:00:00.000Z') } }),
    ).rejects.toThrow();
  });

  it('edits only what comes, and audits the fields that changed with codes only', async () => {
    const id = (await post(fracture)).body.data.id;

    const res = await auth(request(app).patch(`${url()}/${id}`)).send({
      occurred: { date: '2019-05-01', precision: 'MONTH', approximate: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      kind: 'FRACTURE',
      description: 'Fractura de muñeca izquierda',
      occurred: { date: '2019-05-01', precision: 'MONTH', approximate: true },
    });

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: clinic.tenantId, entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, entity: true, params: true },
    });
    expect(rows).toEqual([
      { action: 'PATIENT_EVENT_RECORDED', entity: 'PATIENT_EVENT', params: { kind: 'FRACTURE' } },
      { action: 'PATIENT_EVENT_UPDATED', entity: 'PATIENT_EVENT', params: { kind: 'FRACTURE', changedFields: ['occurred'] } },
    ]);
  });

  it('deletes logically: gone from the list, the row and its audit stay', async () => {
    const id = (await post(fracture)).body.data.id;

    expect((await auth(request(app).delete(`${url()}/${id}`))).status).toBe(204);

    const list = await auth(request(app).get(url()));
    expect(list.body.data.map((e: { id: string }) => e.id)).not.toContain(id);
    const row = await prisma.patientEvent.findUniqueOrThrow({ where: { id }, select: { deletedAt: true } });
    expect(row.deletedAt).not.toBeNull();
    expect((await auth(request(app).patch(`${url()}/${id}`)).send({ description: 'Tarde' })).status).toBe(404);
    expect((await auth(request(app).delete(`${url()}/${id}`))).status).toBe(404);
  });

  it('answers 404 for another patient’s event, another clinic’s patient and an unknown id', async () => {
    const othersEvent = (await post(fracture, otherPatient.id)).body.data.id;
    expect((await auth(request(app).patch(`${url()}/${othersEvent}`)).send({ description: 'Ajeno' })).status).toBe(404);
    expect((await auth(request(app).delete(`${url()}/${othersEvent}`))).status).toBe(404);

    const patientB = await prisma.patient.create({
      data: { tenantId: clinicB.tenantId, fullName: 'De otra clínica' },
      select: { id: true },
    });
    expect((await auth(request(app).get(url(patientB.id)))).status).toBe(404);
    expect((await post(fracture, patientB.id)).status).toBe(404);
    expect((await auth(request(app).delete(`${url()}/${randomUUID()}`))).status).toBe(404);
  });
});
