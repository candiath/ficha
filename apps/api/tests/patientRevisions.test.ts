import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';

// The write path of a patient's versions (SPEC-clinical-revisions.md §1, §5):
// identification and clinical context are versioned, contact and coverage are
// not.
describe('patient revisions', () => {
  let clinic: TestClinic;
  let token: string;

  const REASON = { reason: 'DATA_ENTRY_ERROR' };
  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const patch = (id: string, body: object) => auth(request(app).patch(`/api/patients/${id}`)).send({ ...REASON, ...body });
  const get = async (id: string) => (await auth(request(app).get(`/api/patients/${id}`))).body.data;

  const newPatient = async (body: object = {}): Promise<string> => {
    const res = await auth(request(app).post('/api/patients')).send({ firstName: 'Ana', lastName: 'Versión', ...body });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const revisions = (patientId: string) =>
    prisma.patientRevision.findMany({ where: { patientId }, orderBy: { version: 'asc' } });
  const auditRows = (patientId: string) =>
    prisma.auditLog.findMany({ where: { entityId: patientId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    clinic = await createTestClinic();
    token = await createTestToken(await clinic.createUser());
  });

  afterAll(async () => {
    await sleep(200);
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  it('writes version 1 on creation, under its audit row', async () => {
    const res = await auth(request(app).post('/api/patients')).send({
      firstName: 'Ana',
      lastName: 'Pérez',
      birthDate: '1980-05-03',
      sex: 'FEMALE',
      occupation: 'Docente',
      phone: '11 5555-0000',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);

    const [revision, ...rest] = await revisions(res.body.data.id);
    const [audit] = await auditRows(res.body.data.id);
    expect(rest).toEqual([]);
    expect(revision).toMatchObject({ version: 1, auditLogId: audit.id, schemaVersion: 1, reasonNote: null });
    // Identification and clinical context; no phone.
    expect(revision.snapshot).toEqual({
      firstName: 'Ana',
      lastName: 'Pérez',
      birthDate: '1980-05-03T00:00:00.000Z',
      sex: 'FEMALE',
      occupation: 'Docente',
      referringDoctor: null,
    });
  });

  it('writes the next version of a correction, with its reason and note', async () => {
    const id = await newPatient();
    const res = await patch(id, { occupation: 'Abogada', reason: 'LATE_INFORMATION', reasonNote: 'Lo dijo hoy', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ occupation: 'Abogada', version: 2 });
    const [, second] = await revisions(id);
    const [, audit] = await auditRows(id);
    expect(second).toMatchObject({ version: 2, auditLogId: audit.id, reasonNote: 'Lo dijo hoy' });
    expect(second.snapshot).toMatchObject({ occupation: 'Abogada' });
    expect(audit).toMatchObject({
      action: 'PATIENT_UPDATED',
      params: { changedFields: ['occupation'], reason: 'LATE_INFORMATION' },
    });
  });

  it('records a phone or coverage change in the audit row, and writes no version', async () => {
    const id = await newPatient();
    const res = await patch(id, { phone: '11 4444-0000', insuranceName: 'OSDE' });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(await revisions(id)).toHaveLength(1);
    expect((await auditRows(id)).map((r) => r.params)).toEqual([
      {},
      { changedFields: ['phone', 'insuranceName'], reason: 'DATA_ENTRY_ERROR' },
    ]);
  });

  it('answers 200 to a save that changes nothing, and writes no row, no audit row and no version', async () => {
    const id = await newPatient({ occupation: 'Docente' });
    const before = await get(id);

    const res = await patch(id, { firstName: 'Ana', occupation: '  Docente  '.trim(), expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(before);
    expect((await get(id)).updatedAt).toBe(before.updatedAt);
    expect(await auditRows(id)).toHaveLength(1);
    expect(await revisions(id)).toHaveLength(1);
  });

  it('requires a reason for every correction', async () => {
    const id = await newPatient();
    const res = await auth(request(app).patch(`/api/patients/${id}`)).send({ occupation: 'Sin motivo' });
    expect(res.status).toBe(400);
    expect((await get(id)).occupation).toBeNull();
  });

  it('answers 409 to a stale version, and writes nothing', async () => {
    const id = await newPatient();
    await patch(id, { occupation: 'Primera' });

    const res = await patch(id, { occupation: 'Segunda', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(STALE);
    expect((await get(id)).occupation).toBe('Primera');
    expect(await revisions(id)).toHaveLength(2);
  });

  it('lets one of two concurrent edits of the same version through', async () => {
    const id = await newPatient();
    const results = await Promise.all([
      patch(id, { occupation: 'Una', expectedVersion: 1 }),
      patch(id, { occupation: 'Otra', expectedVersion: 1 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2]);
  });

  it('without a version, makes consecutive versions of two concurrent edits: none is lost', async () => {
    const id = await newPatient();
    const results = await Promise.all([patch(id, { occupation: 'Una' }), patch(id, { referringDoctor: 'Dr. Otro' })]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const all = await revisions(id);
    expect(all.map((r) => r.version)).toEqual([1, 2, 3]);
    expect(all[2].snapshot).toMatchObject({ occupation: 'Una', referringDoctor: 'Dr. Otro' });
  });

  it('writes a version with the same content when the patient is deleted, with no reason', async () => {
    const id = await newPatient();
    const res = await auth(request(app).delete(`/api/patients/${id}`));
    expect(res.status).toBe(204);

    const [first, second] = await revisions(id);
    const [, audit] = await auditRows(id);
    expect(second).toMatchObject({ version: 2, auditLogId: audit.id, reasonNote: null });
    expect(second.snapshot).toEqual(first.snapshot);
    expect(audit).toMatchObject({ action: 'PATIENT_DELETED', params: {} });
  });

  it('is version 0 until its first edit, which writes version 1', async () => {
    // A row written before revisions existed: no version, no audit row.
    const { id } = await prisma.patient.create({ data: { tenantId: clinic.tenantId, firstName: 'Sin', lastName: 'Historia' } });
    expect((await get(id)).version).toBe(0);

    const res = await patch(id, { occupation: 'Docente', expectedVersion: 0 });

    expect(res.body.data.version).toBe(1);
    expect((await revisions(id)).map((r) => r.version)).toEqual([1]);
  });

  it('carries no version in the list: an edit form reads the record', async () => {
    await newPatient();
    const res = await auth(request(app).get('/api/patients'));
    expect(res.body.data[0]).not.toHaveProperty('version');
  });
});
