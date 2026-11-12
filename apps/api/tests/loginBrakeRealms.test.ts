import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  createTestClinic,
  createTestOperator,
  createTestToken,
  TEST_PASSWORD,
  type TestClinic,
  type TestOperator,
} from './helpers';

const THROTTLED = { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };

// The account brake counts per realm, and decides each attempt under a lock
// (lib/loginGuard.ts, area 2 review M1, L2, L3). Every request comes from its
// own address, so the per-IP limiter never answers: every 429 here is the
// account brake. In its own file: it piles up failures no other suite should
// inherit.
describe('the account brake, per realm', { timeout: 60_000 }, () => {
  let clinic: TestClinic;
  let operator: TestOperator;
  let nextIp = 1;
  const from = () => `10.1.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`;

  const clinicLogin = (email: string, password: string) =>
    request(app).post('/api/auth/login').set('X-Forwarded-For', from()).send({ email, password });
  const operatorLogin = (email: string, password: string) =>
    request(app).post('/api/platform/auth/login').set('X-Forwarded-For', from()).send({ email, password });

  beforeAll(async () => {
    clinic = await createTestClinic();
    operator = await createTestOperator();
  });

  afterAll(async () => {
    await prisma.loginEvent.deleteMany({ where: { email: operator.operator.email } });
    await clinic.cleanup();
    await operator.cleanup();
  });

  it("a clinic login with the operator's email does not clear the operator's streak", async () => {
    // A clinic user created with the operator's email, whose password is known.
    await prisma.user.create({
      data: {
        tenantId: clinic.tenantId,
        email: operator.operator.email,
        name: 'Misma dirección',
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      },
    });
    const email = operator.operator.email;

    for (let i = 0; i < 9; i++) expect((await operatorLogin(email, 'incorrecta')).status).toBe(401);
    expect((await clinicLogin(email, TEST_PASSWORD)).status).toBe(200);
    expect((await operatorLogin(email, 'incorrecta')).status).toBe(401);

    // Ten failures in a row at the operator's door: braked, even with her password.
    const res = await operatorLogin(email, TEST_PASSWORD);
    expect(res.status).toBe(429);
    expect(res.body).toEqual(THROTTLED);
  });

  it('a burst of concurrent attempts is counted, not let through together', async () => {
    const user = await clinic.createUser();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => clinicLogin(user.email, 'incorrecta')),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(10);
    expect(await prisma.loginEvent.count({ where: { email: user.email } })).toBe(10);
  });

  it('guessing the current password locks the session making the guesses, not the account', async () => {
    const user = await clinic.createUser();
    const stolen = await createTestToken(user);
    const owners = await createTestToken(user);
    const change = (token: string, currentPassword: string, newPassword = 'otra-contraseña') =>
      request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', from())
        .send({ currentPassword, newPassword });

    for (let i = 0; i < 10; i++) expect((await change(stolen, 'incorrecta')).status).toBe(400);
    // The eleventh ends the session that made the guesses.
    const braked = await change(stolen, 'incorrecta');
    expect(braked.status).toBe(401);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${stolen}`);
    expect(me.status).toBe(401);

    // The owner's own session is not braked: she changes the password.
    expect((await change(owners, TEST_PASSWORD, 'la-nueva-de-ella')).status).toBe(204);
    expect((await clinicLogin(user.email, 'la-nueva-de-ella')).status).toBe(200);
  });
});
