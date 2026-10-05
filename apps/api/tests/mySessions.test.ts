import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  LAST_USED_THROTTLE_MS,
  NORMAL_SESSION,
  TRUSTED_SESSION,
  TRUSTED_SESSIONS_PER_USER,
} from '../src/lib/sessionPolicy';
import { hashSessionToken } from '../src/lib/sessionToken';
import { createTestClinic, createTestToken, TEST_PASSWORD, type TestClinic } from './helpers';

// Session lifetime and the session list (docs/specs/SPEC-my-sessions.md).
// Sessions are placed on the timeline directly in the DB (lastUsedAt, ttlMs)
// instead of waiting for real time to pass.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms);

const me = (token: string) =>
  request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

const lastUsedAt = async (token: string) =>
  (await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } }))
    .lastUsedAt;

describe('idle expiry', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('a normal session unused for longer than its idle timeout is rejected', async () => {
    const token = await createTestToken(user, { lastUsedAt: ago(NORMAL_SESSION.idleMs + MINUTE) });

    const res = await me(token);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('a normal session used within its idle timeout works', async () => {
    const token = await createTestToken(user, { lastUsedAt: ago(NORMAL_SESSION.idleMs - 5 * MINUTE) });

    expect((await me(token)).status).toBe(200);
  });

  it('a trusted session survives an idle time that kills a normal one', async () => {
    const token = await createTestToken(user, {
      trusted: true,
      ttlMs: TRUSTED_SESSION.absoluteMs,
      lastUsedAt: ago(2 * HOUR),
    });

    expect((await me(token)).status).toBe(200);
  });

  it('a trusted session unused for longer than its idle timeout is rejected', async () => {
    const token = await createTestToken(user, {
      trusted: true,
      ttlMs: TRUSTED_SESSION.absoluteMs,
      lastUsedAt: ago(TRUSTED_SESSION.idleMs + HOUR),
    });

    expect((await me(token)).status).toBe(401);
  });

  it('a session past its absolute timeout is rejected even if used a moment ago', async () => {
    const token = await createTestToken(user, { trusted: true, ttlMs: -MINUTE });

    expect((await me(token)).status).toBe(401);
  });
});

describe('last use refresh', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('a stale last use is refreshed by the next request', async () => {
    const stale = ago(LAST_USED_THROTTLE_MS + 10 * MINUTE);
    const token = await createTestToken(user, { lastUsedAt: stale });

    expect((await me(token)).status).toBe(200);

    // The refresh is fire-and-forget: give it a moment to land.
    await expect
      .poll(async () => (await lastUsedAt(token)).getTime(), { timeout: 5000 })
      .toBeGreaterThan(Date.now() - MINUTE);
  });

  it('within the throttle window, requests do not write last use again', async () => {
    const recent = ago(MINUTE);
    const token = await createTestToken(user, { lastUsedAt: recent });

    expect((await me(token)).status).toBe(200);
    expect((await me(token)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((await lastUsedAt(token)).getTime()).toBe(recent.getTime());
  });
});

describe('trusted login', () => {
  let clinic: TestClinic;
  let user: User;
  // Each login from its own address: the per-IP limiter stays out of the way.
  let nextIp = 1;

  const login = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.2.0.${nextIp++}`)
      .send({ email: user.email, password: TEST_PASSWORD, ...body });

  const sessionOf = (token: string) =>
    prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } });

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('trustDevice: true creates a trusted session with the long absolute timeout', async () => {
    const res = await login({ trustDevice: true });
    expect(res.status).toBe(200);

    const session = await sessionOf(res.body.data.token as string);
    expect(session.trusted).toBe(true);
    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(ttl - TRUSTED_SESSION.absoluteMs)).toBeLessThan(MINUTE);
  });

  it('trustDevice: false creates a normal session', async () => {
    const res = await login({ trustDevice: false });
    expect(res.status).toBe(200);
    expect((await sessionOf(res.body.data.token as string)).trusted).toBe(false);
  });

  it('a non-boolean trustDevice is rejected', async () => {
    const res = await login({ trustDevice: 'yes' });
    expect(res.status).toBe(400);
  });

  it(`a trusted login beyond ${TRUSTED_SESSIONS_PER_USER} demotes the oldest trusted session, without closing it`, async () => {
    const other = await clinic.createUser();
    const existing: string[] = [];
    for (let i = 0; i < TRUSTED_SESSIONS_PER_USER; i++) {
      existing.push(await createTestToken(other, { trusted: true, ttlMs: TRUSTED_SESSION.absoluteMs }));
    }

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.2.0.${nextIp++}`)
      .send({ email: other.email, password: TEST_PASSWORD, trustDevice: true });
    expect(res.status).toBe(200);

    const [oldest, ...rest] = await Promise.all(existing.map(sessionOf));
    expect(oldest.trusted).toBe(false);
    expect(oldest.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + NORMAL_SESSION.absoluteMs + MINUTE);
    expect(oldest.revokedAt).toBeNull();
    for (const session of rest) expect(session.trusted).toBe(true);
    expect((await sessionOf(res.body.data.token as string)).trusted).toBe(true);

    // Demoted, not closed: it still works, now under the normal profile.
    expect((await me(existing[0])).status).toBe(200);
  });
});
