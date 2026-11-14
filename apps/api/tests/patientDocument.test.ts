import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// The document that identifies a patient: a type and a number, both or
// neither, normalized, and one patient per document in a clinic.
describe('patient document', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let token: string;
  let otherToken: string;

  // Each test its own number: the unique key is the clinic's.
  let next = 30_000_000;
  const dni = () => String(next++);

  const as = (t: string) => (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  const post = (body: object, t = token) =>
    as(t)(request(app).post('/api/patients')).send({ firstName: 'Ana', lastName: 'Documento', ...body });
  const patch = (id: string, body: object) =>
    as(token)(request(app).patch(`/api/patients/${id}`)).send({ reason: 'DATA_ENTRY_ERROR', ...body });
  const count = () => prisma.patient.count({ where: { tenantId: clinic.tenantId } });

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
    token = await createTestToken(await clinic.createUser());
    otherToken = await createTestToken(await other.createUser());
  });

  afterAll(async () => {
    await sleep(200);
    await deleteAuditRows([clinic.tenantId, other.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: { in: [clinic.tenantId, other.tenantId] } } });
    await clinic.cleanup();
    await other.cleanup();
  });

  it('stores a DNI as its digits, and versions it', async () => {
    const number = dni();
    const written = `${number.slice(0, 2)}.${number.slice(2, 5)}.${number.slice(5)}`;

    const res = await post({ documentType: 'DNI', documentNumber: ` ${written} ` });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ documentType: 'DNI', documentNumber: number, version: 1 });
    const revision = await prisma.patientRevision.findFirstOrThrow({ where: { patientId: res.body.data.id } });
    expect(revision.schemaVersion).toBe(2);
    expect(revision.snapshot).toMatchObject({ documentType: 'DNI', documentNumber: number });
  });

  it('stores any other document in capitals, without spaces or dots', async () => {
    const res = await post({ documentType: 'PASSPORT', documentNumber: ` ab ${dni()} ` });

    expect(res.status).toBe(201);
    expect(res.body.data.documentNumber).toMatch(/^AB\d{8}$/);
  });

  it('takes a patient with no document, more than once', async () => {
    const first = await post({});
    const second = await post({ documentType: null, documentNumber: '' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data).toMatchObject({ documentType: null, documentNumber: null });
    expect(second.body.data).toMatchObject({ documentType: null, documentNumber: null });
  });

  it('refuses a type without its number, a number without its type, and one sent alone', async () => {
    const before = await count();

    const cases = [
      { body: { documentType: 'DNI', documentNumber: '' }, error: 'Ingresá el número de documento' },
      { body: { documentType: null, documentNumber: '30123456' }, error: 'Elegí el tipo de documento' },
      { body: { documentNumber: '30123456' }, error: 'El tipo y el número de documento se envían juntos' },
      { body: { documentType: 'DNI' }, error: 'El tipo y el número de documento se envían juntos' },
      { body: { documentType: 'DNI', documentNumber: '12-AB' }, error: 'El DNI debe tener entre 6 y 9 dígitos' },
      { body: { documentType: 'CUIL', documentNumber: '20301234567' }, error: undefined },
    ];
    for (const { body, error } of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      if (error) expect(JSON.stringify(res.body), JSON.stringify(body)).toContain(error);
    }
    expect(await count()).toBe(before);
  });

  it('refuses a second patient with the same document, naming who has it', async () => {
    const number = dni();
    const first = await post({ firstName: 'Primera', lastName: 'Titular', documentType: 'DNI', documentNumber: number });
    const before = await count();

    // Written another way: the same document.
    const res = await post({ documentType: 'DNI', documentNumber: `${number.slice(0, 2)}.${number.slice(2)}` });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Ya hay un paciente con ese documento: Primera Titular');
    expect(res.body.holder).toEqual({ id: first.body.data.id, fullName: 'Primera Titular', deleted: false });
    expect(await count()).toBe(before);
  });

  it('refuses the document of a deleted patient, and says she can be restored', async () => {
    const number = dni();
    const first = await post({ firstName: 'Borrada', lastName: 'Titular', documentType: 'DNI', documentNumber: number });
    expect((await as(token)(request(app).delete(`/api/patients/${first.body.data.id}`))).status).toBe(204);

    const res = await post({ documentType: 'DNI', documentNumber: number });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'Ya hay un paciente con ese documento: Borrada Titular, que está eliminado. Restauralo desde Pacientes eliminados.',
    );
    expect(res.body.holder).toMatchObject({ id: first.body.data.id, deleted: true });
  });

  it('lets the same number be another type, and another clinic have it', async () => {
    const number = dni();
    expect((await post({ documentType: 'DNI', documentNumber: number })).status).toBe(201);

    expect((await post({ documentType: 'FOREIGN_ID', documentNumber: number })).status).toBe(201);
    const elsewhere = await post({ documentType: 'DNI', documentNumber: number }, otherToken);
    expect(elsewhere.status).toBe(201);
  });

  it('adds, changes and clears the document of a patient, each as a version', async () => {
    const created = await post({});
    const id = created.body.data.id as string;
    const number = dni();

    const added = await patch(id, { documentType: 'DNI', documentNumber: number, expectedVersion: 1 });
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ documentType: 'DNI', documentNumber: number, version: 2 });

    const cleared = await patch(id, { documentType: null, documentNumber: null, expectedVersion: 2 });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ documentType: null, documentNumber: null, version: 3 });

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'PATIENT_UPDATED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows.map((r) => r.params)).toEqual([
      { changedFields: ['documentType', 'documentNumber'], reason: 'DATA_ENTRY_ERROR' },
      { changedFields: ['documentType', 'documentNumber'], reason: 'DATA_ENTRY_ERROR' },
    ]);
  });

  it('refuses an edit to a document another patient has, and writes nothing', async () => {
    const number = dni();
    const holder = await post({ firstName: 'Ya', lastName: 'Registrada', documentType: 'DNI', documentNumber: number });
    const created = await post({ occupation: 'Docente' });
    const id = created.body.data.id as string;

    const res = await patch(id, { occupation: 'Abogada', documentType: 'DNI', documentNumber: number, expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.holder).toMatchObject({ id: holder.body.data.id, deleted: false });
    const row = await prisma.patient.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ occupation: 'Docente', documentType: null, documentNumber: null });
    expect(await prisma.patientRevision.count({ where: { patientId: id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(1);
  });

  // What the API guarantees, the database holds too: a write path that skips
  // the route cannot store half a document, nor one the unique key would miss.
  it('the database refuses half a document and a number that is not normalized', async () => {
    const base = { tenantId: clinic.tenantId, firstName: 'Directa', lastName: 'Base' };

    await expect(prisma.patient.create({ data: { ...base, documentType: 'DNI' } })).rejects.toThrow();
    await expect(prisma.patient.create({ data: { ...base, documentNumber: '30123456' } })).rejects.toThrow();
    await expect(
      prisma.patient.create({ data: { ...base, documentType: 'DNI', documentNumber: '30.123.456' } }),
    ).rejects.toThrow();
    await expect(
      prisma.patient.create({ data: { ...base, documentType: 'PASSPORT', documentNumber: 'ab 123' } }),
    ).rejects.toThrow();
  });
});

// The worked example of a snapshot schema change (packages/shared
// clinicalSnapshots.ts): the document made the patient snapshot version 2.
// A patient whose versions were written before keeps her rows as they are.
describe('a patient written with the earlier snapshot version', () => {
  let clinic: TestClinic;
  let token: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const patch = (id: string, body: object) =>
    auth(request(app).patch(`/api/patients/${id}`)).send({ reason: 'DATA_ENTRY_ERROR', ...body });
  const revisions = (patientId: string) =>
    prisma.patientRevision.findMany({ where: { patientId }, orderBy: { version: 'asc' } });
  const legacy = (occupation = 'Docente') =>
    fixture.patient.createAtSchemaV1({
      data: { tenantId: clinic.tenantId, firstName: 'Vera', lastName: 'Anterior', occupation },
    });

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

  it('is read as before, at her version', async () => {
    const { id } = await legacy();

    const res = await auth(request(app).get(`/api/patients/${id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ version: 1, occupation: 'Docente', documentType: null, documentNumber: null });
  });

  it('is edited over that version, and the new one is written with the current schema', async () => {
    const { id } = await legacy();

    const res = await patch(id, { occupation: 'Abogada', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    const [v1, v2] = await revisions(id);
    // The old row is as it was written.
    expect(v1.schemaVersion).toBe(1);
    expect(v1.snapshot).not.toHaveProperty('documentType');
    expect(v2.schemaVersion).toBe(2);
    expect(v2.snapshot).toMatchObject({ occupation: 'Abogada', documentType: null, documentNumber: null });
  });

  it('a save that changes nothing writes nothing, though the schema has a new field', async () => {
    const { id } = await legacy();

    const res = await patch(id, { occupation: 'Docente', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(await revisions(id)).toHaveLength(1);
  });

  it('refuses a stale edit as any other', async () => {
    const { id } = await legacy();
    expect((await patch(id, { occupation: 'Abogada', expectedVersion: 1 })).status).toBe(200);

    expect((await patch(id, { occupation: 'Otra', expectedVersion: 1 })).status).toBe(409);
  });

  it('shows her old version in the history as it was stored, with its schema version', async () => {
    const { id } = await legacy();
    await patch(id, { documentType: 'DNI', documentNumber: '20999888', expectedVersion: 1 });

    const old = await auth(request(app).get(`/api/patients/${id}/revisions/1`));
    const current = await auth(request(app).get(`/api/patients/${id}/revisions/2`));

    expect(old.status).toBe(200);
    expect(old.body.data.schemaVersion).toBe(1);
    expect(old.body.data.snapshot).not.toHaveProperty('documentNumber');
    expect(current.body.data.schemaVersion).toBe(2);
    expect(current.body.data.snapshot).toMatchObject({ documentType: 'DNI', documentNumber: '20999888' });
  });

  it('can be deleted and restored, each a version of the current schema', async () => {
    const { id } = await legacy();

    expect((await auth(request(app).delete(`/api/patients/${id}`))).status).toBe(204);
    expect((await auth(request(app).post(`/api/patients/${id}/restore`))).status).toBe(204);

    expect((await revisions(id)).map((r) => [r.version, r.schemaVersion])).toEqual([
      [1, 1],
      [2, 2],
      [3, 2],
    ]);
  });
});
