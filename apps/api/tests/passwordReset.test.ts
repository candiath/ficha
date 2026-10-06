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
