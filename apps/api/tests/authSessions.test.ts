import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashSessionToken } from '../src/lib/sessionToken';
import {
  createTestClinic,
  createTestOperator,
  createTestToken,
  TEST_PASSWORD,
  type TestClinic,
  type TestOperator,
} from './helpers';

// Server-side sessions as seen from login (docs/specs/SPEC-server-sessions.md).
// Each login spends rate limiter budget, so this suite logs in sparingly.

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

describe('login sessions', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();

    const res = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'session-test-agent/1.0')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.data.token as string;
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('returns an opaque token that authenticates', async () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
  });

  it('stores the session with its hash, never the token itself', async () => {
    const sessions = await prisma.authSession.findMany({ where: { userId: user.id } });

    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session.tokenHash.equals(hashSessionToken(token))).toBe(true);
    // The raw token appears in no column of the row.
    expect(JSON.stringify(session)).not.toContain(token);
  });

  // A plain login is a normal session (lib/sessionPolicy.ts): 12 h absolute.
  it('records the expiry, IP and user agent of the login', async () => {
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });

    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(ttl - TWELVE_HOURS_MS)).toBeLessThan(60_000);
    expect(session.trusted).toBe(false);
    expect(session.revokedAt).toBeNull();
    expect(session.userAgent).toBe('session-test-agent/1.0');
    expect(session.ip).toBeTruthy();
  });
});

describe('logout', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  const logout = (token: string) =>
    request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  const me = (token: string) =>
    request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  it('revokes the current session and leaves the user\'s other sessions alive', async () => {
    const current = await createTestToken(user);
    const otherDevice = await createTestToken(user);

    const res = await logout(current);
    expect(res.status).toBe(204);

    expect((await me(current)).status).toBe(401);
    expect((await me(otherDevice)).status).toBe(200);

    const revoked = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(current) },
    });
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('a second logout with the same token is a plain 401, not an error', async () => {
    const token = await createTestToken(user);
    await logout(token);

    const res = await logout(token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

// Deactivation revokes sessions on write (docs/specs/SPEC-server-sessions.md).
// The read-side join already denies a deactivated user; what these tests pin
// down is that reactivating does NOT bring the old sessions back.
describe('deactivation revokes sessions', { timeout: 30_000 }, () => {
  let clinic: TestClinic;
  let admin: User;
  let adminToken: string;
  let op: TestOperator;

  const me = (token: string) =>
    request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
  const asOperator = (r: request.Test) => r.set('Authorization', `Bearer ${op.token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    admin = await clinic.createUser({ role: 'ADMIN' });
    adminToken = await createTestToken(admin);
    op = await createTestOperator();
  });

  afterAll(async () => {
    await op.cleanup();
    await clinic.cleanup();
  });

  it('an ADMIN deactivating a user closes her sessions for good', async () => {
    const target = await clinic.createUser();
    const token = await createTestToken(target);

    const off = await asAdmin(request(app).patch(`/api/users/${target.id}`)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await me(token)).status).toBe(401);

    const on = await asAdmin(request(app).patch(`/api/users/${target.id}`)).send({ isActive: true });
    expect(on.status).toBe(200);
    expect((await me(token)).status).toBe(401);
  });

  it('the operator deactivating a user closes her sessions for good', async () => {
    const target = await clinic.createUser();
    const token = await createTestToken(target);
    const path = `/api/platform/tenants/${clinic.tenantId}/users/${target.id}`;

    expect((await asOperator(request(app).patch(path)).send({ isActive: false })).status).toBe(200);
    expect((await asOperator(request(app).patch(path)).send({ isActive: true })).status).toBe(200);

    expect((await me(token)).status).toBe(401);
  });

  it('a refused deactivation (the last active ADMIN) revokes nothing', async () => {
    const path = `/api/platform/tenants/${clinic.tenantId}/users/${admin.id}`;

    const res = await asOperator(request(app).patch(path)).send({ isActive: false });

    expect(res.status).toBe(409);
    expect((await me(adminToken)).status).toBe(200);
  });

  it('a role change revokes nothing (role is read fresh on every request)', async () => {
    const target = await clinic.createUser();
    const token = await createTestToken(target);

    const res = await asAdmin(request(app).patch(`/api/users/${target.id}`)).send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect((await me(token)).status).toBe(200);
  });

  it('deactivating a clinic closes every session of its users for good', async () => {
    const other = await createTestClinic();
    try {
      const a = await other.createUser();
      const b = await other.createUser();
      const tokens = [await createTestToken(a), await createTestToken(b)];
      const path = `/api/platform/tenants/${other.tenantId}`;

      expect((await asOperator(request(app).patch(path)).send({ active: false })).status).toBe(200);
      expect((await asOperator(request(app).patch(path)).send({ active: true })).status).toBe(200);

      for (const token of tokens) expect((await me(token)).status).toBe(401);
      // Other clinics are untouched.
      expect((await me(adminToken)).status).toBe(200);
    } finally {
      await other.cleanup();
    }
  });
});
