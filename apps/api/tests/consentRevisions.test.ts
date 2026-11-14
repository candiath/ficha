import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// An informed consent's versions (SPEC-clinical-revisions.md §4): signing,
// signing again and revoking are facts, each a version, with no reason.
describe('consent revisions', () => {
  let clinic: TestClinic;
  let token: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (patientId: string) => `/api/patients/${patientId}/consent`;
  const sign = (patientId: string, body: object = {}) => auth(request(app).post(url(patientId))).send(body);
  const revoke = (patientId: string) => auth(request(app).delete(url(patientId)));

  const newPatient = async () =>
    (await fixture.patient.create({ data: { tenantId: clinic.tenantId, firstName: 'Con', lastName: 'Consentimiento' } })).id;
  const revisions = (patientId: string) =>
    prisma.consentRevision.findMany({ where: { patientId }, orderBy: { version: 'asc' } });

  beforeAll(async () => {
    clinic = await createTestClinic();
    token = await createTestToken(await clinic.createUser());
  });

  afterAll(async () => {
    await sleep(200);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.informedConsent.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('writes a version for the signature, a second signature and the revocation', async () => {
    const patientId = await newPatient();

    const first = await sign(patientId, { expectedVersion: 0 });
    const again = await sign(patientId, { expectedVersion: 1 });
    const revoked = await revoke(patientId);
    expect([first.status, again.status, revoked.status]).toEqual([201, 201, 200]);
    expect([first.body.data.version, again.body.data.version, revoked.body.data.version]).toEqual([1, 2, 3]);

    const all = await revisions(patientId);
    const rows = await prisma.auditLog.findMany({
      where: { entityId: first.body.data.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows.map((r) => [r.action, r.params])).toEqual([
      ['CONSENT_SIGNED', {}],
      ['CONSENT_SIGNED', {}],
      ['CONSENT_REVOKED', {}],
    ]);
    expect(all.map((r) => [r.version, r.auditLogId, r.reasonNote])).toEqual(rows.map((r, i) => [i + 1, r.id, null]));
    expect(all[0].snapshot).toEqual({ signedAt: first.body.data.signedAt, revokedAt: null });
    expect(all[2].snapshot).toEqual({ signedAt: again.body.data.signedAt, revokedAt: revoked.body.data.revokedAt });
  });

  it('answers 409 to a signature over a consent that changed, and writes nothing', async () => {
    const patientId = await newPatient();
    await sign(patientId);

    // The screen still showed it unsigned.
    const res = await sign(patientId, { expectedVersion: 0 });

    expect(res.status).toBe(409);
    expect(await revisions(patientId)).toHaveLength(1);
  });

  it('lets one of two concurrent first signatures through', async () => {
    const patientId = await newPatient();
    const results = await Promise.all([sign(patientId, { expectedVersion: 0 }), sign(patientId, { expectedVersion: 0 })]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await revisions(patientId)).map((r) => r.version)).toEqual([1]);
  });

  it('serializes a signature and a revocation at once: consecutive versions, none lost', async () => {
    const patientId = await newPatient();
    await sign(patientId);

    const results = await Promise.all([sign(patientId), revoke(patientId)]);

    expect(results.map((r) => r.status)).toEqual([201, 200]);
    expect((await revisions(patientId)).map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it('refuses a field the signature does not take', async () => {
    const patientId = await newPatient();
    expect((await sign(patientId, { signedAt: '2020-01-01' })).status).toBe(400);
  });
});
