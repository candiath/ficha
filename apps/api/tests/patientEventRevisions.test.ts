import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// The write path of a patient event's versions (SPEC-clinical-revisions.md §5).
describe('patient event revisions', () => {
  let clinic: TestClinic;
  let token: string;
  let patientId: string;

  const REASON = { reason: 'DATA_ENTRY_ERROR' };
  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (id = '') => `/api/patients/${patientId}/events${id && `/${id}`}`;
  const patch = (id: string, body: object) => auth(request(app).patch(url(id))).send({ ...REASON, ...body });

  const newEvent = async (): Promise<string> => {
    const res = await auth(request(app).post(url())).send({
      kind: 'SURGERY',
      description: 'Cirugía de rodilla',
      occurred: { date: '2019-05-01', precision: 'MONTH', approximate: true },
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const revisions = (patientEventId: string) =>
    prisma.patientEventRevision.findMany({ where: { patientEventId }, orderBy: { version: 'asc' } });
  const auditRows = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    clinic = await createTestClinic();
    token = await createTestToken(await clinic.createUser());
    ({ id: patientId } = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Con', lastName: 'Antecedentes' },
    }));
  });

  afterAll(async () => {
    await sleep(200);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patientEvent.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('writes version 1 on creation, and the next on a correction with its reason and note', async () => {
    const id = await newEvent();
    const res = await patch(id, { description: 'Cirugía de rodilla derecha', reasonNote: 'Era la derecha', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    const [v1, v2] = await revisions(id);
    const rows = await auditRows(id);
    expect(rows.map((r) => [r.action, r.params])).toEqual([
      ['PATIENT_EVENT_RECORDED', { kind: 'SURGERY' }],
      ['PATIENT_EVENT_UPDATED', { kind: 'SURGERY', changedFields: ['description'], reason: 'DATA_ENTRY_ERROR' }],
    ]);
    expect(v1).toMatchObject({ version: 1, auditLogId: rows[0].id, reasonNote: null });
    expect(v1.snapshot).toEqual({
      kind: 'SURGERY',
      description: 'Cirugía de rodilla',
      occurredOn: '2019-05-01',
      occurredPrecision: 'MONTH',
      occurredApproximate: true,
    });
    expect(v2).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: 'Era la derecha' });
    expect(v2.snapshot).toMatchObject({ description: 'Cirugía de rodilla derecha' });
  });

  it('answers 200 to a save that changes nothing, and writes nothing', async () => {
    const id = await newEvent();
    const before = await prisma.patientEvent.findUniqueOrThrow({ where: { id } });

    const res = await patch(id, {
      description: 'Cirugía de rodilla',
      occurred: { date: '2019-05-01', precision: 'MONTH', approximate: true },
      expectedVersion: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect((await prisma.patientEvent.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(before.updatedAt);
    expect(await auditRows(id)).toHaveLength(1);
    expect(await revisions(id)).toHaveLength(1);
  });

  it('requires a reason to correct', async () => {
    const id = await newEvent();
    const res = await auth(request(app).patch(url(id))).send({ description: 'Sin motivo' });
    expect(res.status).toBe(400);
    expect(await revisions(id)).toHaveLength(1);
  });

  it('answers 409 to a stale version, and writes nothing', async () => {
    const id = await newEvent();
    await patch(id, { description: 'Primera corrección' });

    const res = await patch(id, { description: 'Segunda corrección', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(STALE);
    expect(await revisions(id)).toHaveLength(2);
  });

  it('lets one of two concurrent edits of the same version through', async () => {
    const id = await newEvent();
    const results = await Promise.all([
      patch(id, { description: 'Una versión', expectedVersion: 1 }),
      patch(id, { description: 'Otra versión', expectedVersion: 1 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2]);
  });

  it('a concurrent edit and annulment take consecutive versions, or the edit finds no event', async () => {
    const id = await newEvent();
    const [edit, removal] = await Promise.all([
      patch(id, { description: 'Editado a la vez' }),
      auth(request(app).post(`${url(id)}/annul`)).send({ reason: 'DATA_ENTRY_ERROR' }),
    ]);

    expect(removal.status).toBe(204);
    expect([200, 404]).toContain(edit.status);
    const versions = (await revisions(id)).map((r) => r.version);
    expect(versions).toEqual(edit.status === 200 ? [1, 2, 3] : [1, 2]);
  });

  it('writes a version with the same content when the event is annulled, with its reason and note', async () => {
    const id = await newEvent();
    const res = await auth(request(app).post(`${url(id)}/annul`)).send({ reason: 'OTHER', reasonNote: 'Era de otra paciente' });
    expect(res.status).toBe(204);

    const [first, second] = await revisions(id);
    const [, audit] = await auditRows(id);
    expect(audit).toMatchObject({ action: 'PATIENT_EVENT_ANNULLED', params: { kind: 'SURGERY', reason: 'OTHER' } });
    expect(second).toMatchObject({ version: 2, auditLogId: audit.id, reasonNote: 'Era de otra paciente' });
    expect(second.snapshot).toEqual(first.snapshot);
  });
});
