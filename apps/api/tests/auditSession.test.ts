import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, type TestClinic } from './helpers';

// Every audit row written by a clinic user names the login it came from
// (audit-hardening, docs/specs/SPEC-audit-hardening.md §3): the session's id,
// never its token. Only the user herself may list her sessions, so the column
// never leaves the server in the patient's audit log.
describe('audit rows record the session they came from', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let authSessionId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: user.id },
      select: { id: true },
    });
    authSessionId = session.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  it('stores the id of the session that made the request', async () => {
    const res = await auth(request(app).post('/api/patients')).send({ fullName: 'Session Patient' });
    expect(res.status).toBe(201);

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: clinic.tenantId, entityId: res.body.data.id },
    });
    expect(row.authSessionId).toBe(authSessionId);
  });

  it('does not return it in the patient audit log', async () => {
    const created = await auth(request(app).post('/api/patients')).send({ fullName: 'Hidden Session' });
    const res = await auth(request(app).get(`/api/patients/${created.body.data.id}/audit-log`));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty('authSessionId');
  });
});
