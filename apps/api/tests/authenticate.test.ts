import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, signTestToken, type TestClinic } from './helpers';

// authenticate runs on every protected route; /api/auth/me mounts it directly
// and is the simplest probe: if /me answers, authenticate let the request in.
const ME = '/api/auth/me';
const INVALID = { error: 'Sesión expirada o inválida' };

function me(token: string) {
  return request(app).get(ME).set('Authorization', `Bearer ${token}`);
}

describe('authenticate middleware', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('answers 401 without an Authorization header', async () => {
    const res = await request(app).get(ME);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('answers 401 for a scheme other than Bearer', async () => {
    const res = await request(app).get(ME).set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('lets a valid session in and attaches the right user', async () => {
    const res = await me(await createTestToken(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenant: { name: clinic.name, slug: clinic.slug },
    });
  });

  // Every failure below gets the same message on purpose: telling them apart
  // would reveal whether an account exists, is deactivated, and so on.

  it('rejects a token that names no session', async () => {
    const res = await me('not-a-session-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  it('rejects a JWT, even one signed with the right secret', async () => {
    const res = await me(signTestToken(user));

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  it('rejects an expired session', async () => {
    const res = await me(await createTestToken(user, { ttlMs: -1000 }));

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  it('rejects a revoked session', async () => {
    const token = await createTestToken(user);
    await prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  // The safety net: these change users/tenants directly, without revoking any
  // session, the way a future write path that forgets to revoke would. The
  // join in findSessionForAuth must deny access anyway.

  it('rejects a live session of a deactivated user', async () => {
    const target = await clinic.createUser();
    const token = await createTestToken(target);
    await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });

    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(INVALID);
  });

  it('rejects a live session in a deactivated clinic', async () => {
    const other = await createTestClinic();
    try {
      const target = await other.createUser();
      const token = await createTestToken(target);
      await prisma.tenant.update({
        where: { id: other.tenantId },
        data: { deactivatedAt: new Date() },
      });

      const res = await me(token);

      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID);
    } finally {
      await other.cleanup();
    }
  });
});
