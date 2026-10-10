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
} from '../src/lib/authSessionPolicy';
import { hashOpaqueToken } from '../src/lib/opaqueToken';
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
  (await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(token) } }))
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
    prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(token) } });

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

describe('my sessions', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let user: User;
  let colleague: User;
  let outsider: User;

  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const list = (token: string) => as(token, request(app).get('/api/auth/devices'));
  const close = (token: string, id: string) =>
    as(token, request(app).delete(`/api/auth/devices/${id}`));
  const untrust = (token: string, id: string) =>
    as(token, request(app).post(`/api/auth/devices/${id}/untrust`));
  const idOf = async (token: string) =>
    (await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(token) } })).id;

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
    user = await clinic.createUser();
    colleague = await clinic.createUser();
    outsider = await other.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
    await other.cleanup();
  });

  it('lists only her live sessions, most recently used first, the current one marked', async () => {
    const owner = await clinic.createUser();
    const current = await createTestToken(owner);
    const older = await createTestToken(owner, { trusted: true, ttlMs: TRUSTED_SESSION.absoluteMs, lastUsedAt: ago(2 * HOUR) });
    const revoked = await createTestToken(owner);
    await prisma.authSession.update({ where: { id: await idOf(revoked) }, data: { revokedAt: new Date() } });
    await createTestToken(owner, { ttlMs: -MINUTE }); // expired
    await createTestToken(owner, { lastUsedAt: ago(NORMAL_SESSION.idleMs + MINUTE) }); // idle
    await createTestToken(colleague); // someone else's

    const res = await list(current);

    expect(res.status).toBe(200);
    const sessions = res.body.data as Array<Record<string, unknown>>;
    expect(sessions.map((s) => s.id)).toEqual([await idOf(current), await idOf(older)]);
    expect(sessions[0]).toMatchObject({ current: true, trusted: false });
    expect(sessions[1]).toMatchObject({ current: false, trusted: true });
    expect(Object.keys(sessions[0]).sort()).toEqual(
      ['createdAt', 'current', 'expiresAt', 'id', 'ip', 'lastUsedAt', 'trusted', 'userAgent'].sort(),
    );
  });

  it('closes another of her sessions; the current one keeps working', async () => {
    const current = await createTestToken(user);
    const laptop = await createTestToken(user);

    expect((await close(current, await idOf(laptop))).status).toBe(204);

    expect((await me(laptop)).status).toBe(401);
    expect((await me(current)).status).toBe(200);
  });

  it('closing the current session logs her out', async () => {
    const current = await createTestToken(user);

    expect((await close(current, await idOf(current))).status).toBe(204);
    expect((await me(current)).status).toBe(401);
  });

  it('cannot close a colleague\'s session nor one in another clinic: 404, and they keep working', async () => {
    const mine = await createTestToken(user);
    const colleagues = await createTestToken(colleague);
    const outsiders = await createTestToken(outsider);

    for (const target of [colleagues, outsiders]) {
      const res = await close(mine, await idOf(target));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Dispositivo no encontrado' });
      expect((await me(target)).status).toBe(200);
    }
  });

  it('a malformed or unknown session id is a 404', async () => {
    const mine = await createTestToken(user);
    expect((await close(mine, 'not-a-uuid')).status).toBe(404);
    expect((await close(mine, '0199b2f0-0000-7000-8000-000000000000')).status).toBe(404);
  });

  it('closes every other session of hers and nobody else\'s', async () => {
    const owner = await clinic.createUser();
    const current = await createTestToken(owner);
    const others = [await createTestToken(owner), await createTestToken(owner, { trusted: true, ttlMs: TRUSTED_SESSION.absoluteMs })];
    const colleagues = await createTestToken(colleague);
    // Dead ones the list does not show: not counted (found in manual testing:
    // the toast said 3 with 2 devices on screen).
    await createTestToken(owner, { ttlMs: -MINUTE });
    await createTestToken(owner, { lastUsedAt: ago(NORMAL_SESSION.idleMs + MINUTE) });

    const res = await as(current, request(app).post('/api/auth/devices/revoke-others'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { revoked: 2 } });
    for (const token of others) expect((await me(token)).status).toBe(401);
    expect((await me(current)).status).toBe(200);
    expect((await me(colleagues)).status).toBe(200);
  });

  it('untrusts one of her trusted sessions without closing it', async () => {
    const current = await createTestToken(user);
    const phone = await createTestToken(user, { trusted: true, ttlMs: TRUSTED_SESSION.absoluteMs });

    expect((await untrust(current, await idOf(phone))).status).toBe(204);

    const row = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(phone) } });
    expect(row.trusted).toBe(false);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + NORMAL_SESSION.absoluteMs + MINUTE);
    expect((await me(phone)).status).toBe(200);
  });

  it('untrusting a normal session or someone else\'s trusted one is a 404', async () => {
    const current = await createTestToken(user);
    const normal = await createTestToken(user);
    const colleaguesTrusted = await createTestToken(colleague, { trusted: true, ttlMs: TRUSTED_SESSION.absoluteMs });

    expect((await untrust(current, await idOf(normal))).status).toBe(404);
    expect((await untrust(current, await idOf(colleaguesTrusted))).status).toBe(404);
    const row = await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: hashOpaqueToken(colleaguesTrusted) } });
    expect(row.trusted).toBe(true);
  });

  it('every session route requires a session', async () => {
    expect((await request(app).get('/api/auth/devices')).status).toBe(401);
    expect((await request(app).post('/api/auth/devices/revoke-others')).status).toBe(401);
  });
});
