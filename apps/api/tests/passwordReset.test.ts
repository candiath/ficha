import request from 'supertest';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashOpaqueToken } from '../src/lib/opaqueToken';
import { PASSWORD_RESET_TTL_MS } from '../src/lib/passwordReset';
import { createTestClinic, createTestToken, TEST_PASSWORD, type TestClinic } from './helpers';

// Password reset links (docs/specs/SPEC-password-reset.md).

const me = (token: string) =>
  request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });

const linksOf = (userId: string) =>
  prisma.passwordResetToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

const passwordHashOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;

describe('ADMIN generates a reset link', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let admin: User;
  let adminToken: string;

  const generate = (userId: string, token = adminToken) =>
    request(app)
      .post(`/api/users/${userId}/password-reset`)
      .set('Authorization', `Bearer ${token}`)
      .set('User-Agent', 'test-agent/1.0');

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
    admin = await clinic.createUser({ role: 'ADMIN' });
    adminToken = await createTestToken(admin);
  });

  afterAll(async () => {
    await clinic.cleanup();
    await other.cleanup();
  });

  it('returns a single-use token once, valid for 24 hours, not cacheable', async () => {
    const therapist = await clinic.createUser();

    const before = Date.now();
    const res = await generate(therapist.id);

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresAt = new Date(res.body.data.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TTL_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TTL_MS + 1000);
  });

  it('closes her sessions and disables her password at once', async () => {
    const therapist = await clinic.createUser();
    const phone = await createTestToken(therapist);
    const laptop = await createTestToken(therapist, { trusted: true });

    await generate(therapist.id);

    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(401);
    const res = await login(therapist.email, TEST_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
  });

  it('replaces the password with a real bcrypt hash, so login timing does not reveal the reset', async () => {
    const therapist = await clinic.createUser();

    await generate(therapist.id);

    const hash = await passwordHashOf(therapist.id);
    expect(hash).toMatch(/^\$2[aby]\$10\$.{53}$/);
    expect(await bcrypt.compare(TEST_PASSWORD, hash)).toBe(false);
  });

  it('stores only the token hash, plus who generated it and from where', async () => {
    const therapist = await clinic.createUser();

    const res = await generate(therapist.id);

    const [link] = await linksOf(therapist.id);
    expect(link.tokenHash.equals(hashOpaqueToken(res.body.data.token))).toBe(true);
    expect(link).toMatchObject({
      createdByUserId: admin.id,
      createdByOperatorId: null,
      createdUserAgent: 'test-agent/1.0',
      usedAt: null,
      invalidatedAt: null,
    });
    expect(link.createdIp).toEqual(expect.any(String));
  });

  it('a new link retires the earlier unused one', async () => {
    const therapist = await clinic.createUser();

    await generate(therapist.id);
    await generate(therapist.id);

    const [first, second] = await linksOf(therapist.id);
    expect(first.invalidatedAt).not.toBeNull();
    expect(second.invalidatedAt).toBeNull();
  });

  it('works on another ADMIN of the clinic', async () => {
    const otherAdmin = await clinic.createUser({ role: 'ADMIN' });

    expect((await generate(otherAdmin.id)).status).toBe(201);
  });

  it('a user of another clinic is a 404 and nothing changes', async () => {
    const foreign = await other.createUser();
    const foreignToken = await createTestToken(foreign);
    const hashBefore = await passwordHashOf(foreign.id);

    const res = await generate(foreign.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
    expect((await me(foreignToken)).status).toBe(200);
    expect(await passwordHashOf(foreign.id)).toBe(hashBefore);
    expect(await linksOf(foreign.id)).toHaveLength(0);
  });

  it('an inactive user is a 409 and nothing changes', async () => {
    const inactive = await clinic.createUser({ isActive: false });
    const hashBefore = await passwordHashOf(inactive.id);

    const res = await generate(inactive.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'El usuario está desactivado' });
    expect(await passwordHashOf(inactive.id)).toBe(hashBefore);
    expect(await linksOf(inactive.id)).toHaveLength(0);
  });

  it('herself is a 400 pointing to Mi cuenta, and nothing changes', async () => {
    const hashBefore = await passwordHashOf(admin.id);

    const res = await generate(admin.id);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Para cambiar tu contraseña usá Mi cuenta' });
    expect((await me(adminToken)).status).toBe(200);
    expect(await passwordHashOf(admin.id)).toBe(hashBefore);
  });

  it('a THERAPIST cannot do it', async () => {
    const therapist = await clinic.createUser();
    const target = await clinic.createUser();

    const res = await generate(target.id, await createTestToken(therapist));

    expect(res.status).toBe(403);
    expect(await linksOf(target.id)).toHaveLength(0);
  });
});

describe('using a reset link', () => {
  let clinic: TestClinic;
  let adminToken: string;
  // Each public request comes from its own IP (trust proxy reads
  // X-Forwarded-For), so the per-IP limiters do not count across tests; the
  // limiter itself has its own test below.
  let nextIp = 1;
  const fromNewIp = () => `10.3.0.${nextIp++}`;

  const NEW_PASSWORD = 'contraseña-nueva-123';

  const check = (token: string) =>
    request(app)
      .post('/api/auth/password-reset/check')
      .set('X-Forwarded-For', fromNewIp())
      .send({ token });

  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    request(app)
      .post('/api/auth/password-reset')
      .set('X-Forwarded-For', fromNewIp())
      .set('User-Agent', 'reset-agent/2.0')
      .send({ token, newPassword });

  const loginFromNewIp = (email: string, password: string) =>
    request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', fromNewIp())
      .send({ email, password });

  const newLink = async (user: User): Promise<string> => {
    const res = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    return res.body.data.token as string;
  };

  const INVALID = { error: 'El enlace no es válido o ya venció' };

  beforeAll(async () => {
    clinic = await createTestClinic();
    adminToken = await createTestToken(await clinic.createUser({ role: 'ADMIN' }));
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('check says whose account a valid link resets', async () => {
    const therapist = await clinic.createUser({ name: 'Tere Fisio' });
    const token = await newLink(therapist);

    const res = await check(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { email: therapist.email, name: 'Tere Fisio' } });
  });

  it('sets the new password: she logs in with it, not with the old one', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);

    const res = await reset(token);

    expect(res.status).toBe(204);
    expect((await loginFromNewIp(therapist.email, NEW_PASSWORD)).status).toBe(200);
    expect((await loginFromNewIp(therapist.email, TEST_PASSWORD)).status).toBe(401);
  });

  it('records when and from where the link was used', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);

    await reset(token);

    const [link] = await linksOf(therapist.id);
    expect(link.usedAt).not.toBeNull();
    expect(link.usedUserAgent).toBe('reset-agent/2.0');
    expect(link.usedIp).toEqual(expect.any(String));
  });

  it('is single use: the second time is the uniform 400 and the password stays', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);
    await reset(token);

    const second = await reset(token, 'otra-contraseña-456');

    expect(second.status).toBe(400);
    expect(second.body).toEqual(INVALID);
    expect((await check(token)).status).toBe(400);
    expect(await bcrypt.compare(NEW_PASSWORD, await passwordHashOf(therapist.id))).toBe(true);
  });

  it('two simultaneous uses: exactly one succeeds', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);

    const results = await Promise.all([reset(token, 'primera-123456'), reset(token, 'segunda-123456')]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    const [link] = await linksOf(therapist.id);
    expect(link.usedAt).not.toBeNull();
  });

  it('closes any session opened after the link was generated', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);
    const lateSession = await createTestToken(therapist);

    await reset(token);

    expect((await me(lateSession)).status).toBe(401);
  });

  describe('every invalid link gets the same 400 and changes nothing', () => {
    const expectInvalid = async (token: string, userId?: string) => {
      const hashBefore = userId ? await passwordHashOf(userId) : null;

      const checked = await check(token);
      const used = await reset(token);

      expect(checked.status).toBe(400);
      expect(checked.body).toEqual(INVALID);
      expect(used.status).toBe(400);
      expect(used.body).toEqual(INVALID);
      if (userId) expect(await passwordHashOf(userId)).toBe(hashBefore);
    };

    it('expired', async () => {
      const therapist = await clinic.createUser();
      const token = await newLink(therapist);
      await prisma.passwordResetToken.updateMany({
        where: { userId: therapist.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expectInvalid(token, therapist.id);
    });

    it('retired by a newer link', async () => {
      const therapist = await clinic.createUser();
      const older = await newLink(therapist);
      await newLink(therapist);

      await expectInvalid(older, therapist.id);
    });

    it('of a user deactivated after it was generated', async () => {
      const therapist = await clinic.createUser();
      const token = await newLink(therapist);
      await prisma.user.update({ where: { id: therapist.id }, data: { isActive: false } });

      await expectInvalid(token, therapist.id);
    });

    it('of a deactivated clinic', async () => {
      const closing = await createTestClinic();
      try {
        const admin = await closing.createUser({ role: 'ADMIN' });
        const therapist = await closing.createUser();
        const res = await request(app)
          .post(`/api/users/${therapist.id}/password-reset`)
          .set('Authorization', `Bearer ${await createTestToken(admin)}`);
        await prisma.tenant.update({
          where: { id: closing.tenantId },
          data: { deactivatedAt: new Date() },
        });

        await expectInvalid(res.body.data.token, therapist.id);
      } finally {
        await closing.cleanup();
      }
    });

    it('unknown', async () => {
      await expectInvalid('A'.repeat(43));
    });

    it('not even shaped like a token', async () => {
      await expectInvalid('no-es-un-token');
    });
  });

  it('a too-short password is rejected and the link stays usable', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);

    const res = await reset(token, 'corta');

    expect(res.status).toBe(400);
    expect(res.body.details.newPassword).toBeDefined();
    expect((await check(token)).status).toBe(200);
  });

  it('takes the token only from the body', async () => {
    const therapist = await clinic.createUser();
    const token = await newLink(therapist);

    const res = await request(app)
      .post(`/api/auth/password-reset?token=${token}`)
      .set('X-Forwarded-For', fromNewIp())
      .send({ newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect((await check(token)).status).toBe(200);
  });

  it('the public routes are rate limited per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/auth/password-reset/check')
        .set('X-Forwarded-For', '10.3.255.1')
        .send({ token: 'A'.repeat(43) });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('the whole flow through the API', () => {
  let clinic: TestClinic;

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('generate → old access dead → check → reset → log in with the new password', async () => {
    const admin = await clinic.createUser({ role: 'ADMIN' });
    const therapist = await clinic.createUser();
    const oldSession = await createTestToken(therapist);

    const generated = await request(app)
      .post(`/api/users/${therapist.id}/password-reset`)
      .set('Authorization', `Bearer ${await createTestToken(admin)}`);
    const token = generated.body.data.token as string;

    expect((await me(oldSession)).status).toBe(401);
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.4.0.1')
      .send({ email: therapist.email, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const checked = await request(app)
      .post('/api/auth/password-reset/check')
      .set('X-Forwarded-For', '10.4.0.2')
      .send({ token });
    expect(checked.body.data.email).toBe(therapist.email);

    const done = await request(app)
      .post('/api/auth/password-reset')
      .set('X-Forwarded-For', '10.4.0.3')
      .send({ token, newPassword: 'la-nueva-de-verdad' });
    expect(done.status).toBe(204);

    const loggedIn = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.4.0.4')
      .send({ email: therapist.email, password: 'la-nueva-de-verdad' });
    expect(loggedIn.status).toBe(200);
    expect((await me(loggedIn.body.data.token)).status).toBe(200);
  });
});
