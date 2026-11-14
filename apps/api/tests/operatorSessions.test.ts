import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashOpaqueToken } from '../src/lib/opaqueToken';
import { LAST_USED_THROTTLE_MS, OPERATOR_SESSION } from '../src/lib/authSessionPolicy';
import {
  createOperatorTestSession,
  createTestOperator,
  TEST_PASSWORD,
  waitFor,
  type TestOperator,
} from './helpers';

// The operator's server-side sessions (docs/specs/SPEC-operator-sessions.md).
const AUTH = '/api/platform/auth';
const MINUTE = 60 * 1000;

let nextIp = 1;
const from = () => `10.77.0.${nextIp++}`;

const me = (token: string) => request(app).get(`${AUTH}/me`).set('Authorization', `Bearer ${token}`);

describe('operator sessions', () => {
  let op: TestOperator;

  beforeAll(async () => {
    op = await createTestOperator();
  });

  afterAll(async () => {
    await op.cleanup();
  });

  it('login creates a session row with the hash, IP and user agent, and its token works', async () => {
    const ip = from();
    const res = await request(app)
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', ip)
      .set('User-Agent', 'operator-sessions-test')
      .send({ email: op.operator.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const token = res.body.data.token as string;

    // Opaque, not a JWT.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await prisma.platformOperatorSession.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
    expect(row).toMatchObject({ operatorId: op.operator.id, ip, userAgent: 'operator-sessions-test', revokedAt: null });
    // The absolute timeout is the operator's profile, from login.
    const lifetime = row!.expiresAt.getTime() - row!.createdAt.getTime();
    expect(Math.abs(lifetime - OPERATOR_SESSION.absoluteMs)).toBeLessThan(5000);

    expect((await me(token)).status).toBe(200);
    expect((await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('logout revokes that session only', async () => {
    const a = await createOperatorTestSession(op.operator);
    const b = await createOperatorTestSession(op.operator);

    const res = await request(app).post(`${AUTH}/logout`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(204);

    expect((await me(a.token)).status).toBe(401);
    expect((await me(b.token)).status).toBe(200);
    const row = await prisma.platformOperatorSession.findUnique({ where: { id: a.operatorSessionId } });
    expect(row?.revokedAt).not.toBeNull();

    // A second logout with the dead token is the usual 401.
    expect((await request(app).post(`${AUTH}/logout`).set('Authorization', `Bearer ${a.token}`)).status).toBe(401);
  });

  it('changing the password revokes every other session and keeps the current one', async () => {
    const target = await createTestOperator();
    try {
      const current = await createOperatorTestSession(target.operator);
      const other = await createOperatorTestSession(target.operator);
      const newPassword = 'otra-clave-de-test-456';

      const res = await request(app)
        .post(`${AUTH}/change-password`)
        .set('X-Forwarded-For', from())
        .set('Authorization', `Bearer ${current.token}`)
        .send({ currentPassword: TEST_PASSWORD, newPassword });
      expect(res.status).toBe(204);

      expect((await me(current.token)).status).toBe(200);
      expect((await me(other.token)).status).toBe(401);
      expect((await me(target.token)).status).toBe(401);

      const login = (password: string) =>
        request(app).post(`${AUTH}/login`).set('X-Forwarded-For', from()).send({ email: target.operator.email, password });
      expect((await login(TEST_PASSWORD)).status).toBe(401);
      expect((await login(newPassword)).status).toBe(200);

      // The deprecated column is no longer written.
      const row = await prisma.platformOperator.findUnique({ where: { id: target.operator.id } });
      expect(row?.passwordChangedAt).toBeNull();
    } finally {
      await target.cleanup();
    }
  });

  it('a session idle past 30 minutes is rejected', async () => {
    const idle = await createOperatorTestSession(op.operator, { lastUsedAt: new Date(Date.now() - 31 * MINUTE) });
    expect((await me(idle.token)).status).toBe(401);

    const recent = await createOperatorTestSession(op.operator, { lastUsedAt: new Date(Date.now() - 29 * MINUTE) });
    expect((await me(recent.token)).status).toBe(200);
  });

  it('a session past its absolute timeout is rejected, however recently used', async () => {
    const expired = await createOperatorTestSession(op.operator, { ttlMs: -1000 });
    const res = await me(expired.token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('a deactivated operator loses every session on the next request', async () => {
    const target = await createTestOperator();
    try {
      expect((await me(target.token)).status).toBe(200);
      await prisma.platformOperator.update({ where: { id: target.operator.id }, data: { isActive: false } });
      expect((await me(target.token)).status).toBe(401);
    } finally {
      await target.cleanup();
    }
  });

  it('refreshes last_used_at only after the throttle window', async () => {
    const stale = new Date(Date.now() - LAST_USED_THROTTLE_MS - MINUTE);
    const fresh = new Date(Date.now() - MINUTE);
    const a = await createOperatorTestSession(op.operator, { lastUsedAt: stale });
    const b = await createOperatorTestSession(op.operator, { lastUsedAt: fresh });

    expect((await me(a.token)).status).toBe(200);
    expect((await me(b.token)).status).toBe(200);

    // The touch is fire-and-forget.
    await waitFor(async () => {
      const row = await prisma.platformOperatorSession.findUnique({ where: { id: a.operatorSessionId } });
      return row && row.lastUsedAt.getTime() > stale.getTime();
    });
    const untouched = await prisma.platformOperatorSession.findUnique({ where: { id: b.operatorSessionId } });
    expect(untouched?.lastUsedAt.getTime()).toBe(fresh.getTime());
  });

  it('a token that names no session is rejected', async () => {
    expect((await me('not-a-session-token')).status).toBe(401);
  });
});

// No JWT left in the system (success criterion of the spec).
describe('no JWT left', () => {
  const root = join(__dirname, '..');

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
    });
  }

  it('jsonwebtoken is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all)).not.toContain('jsonwebtoken');
    expect(Object.keys(all)).not.toContain('@types/jsonwebtoken');
  });

  it('src and scripts neither import jsonwebtoken nor read PLATFORM_JWT_SECRET', () => {
    const offenders = [...sources(join(root, 'src')), ...sources(join(root, 'scripts'))].filter((file) =>
      /jsonwebtoken|PLATFORM_JWT_SECRET/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
