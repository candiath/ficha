import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, TEST_PASSWORD, type TestClinic } from './helpers';

const CHANGE = '/api/auth/change-password';
const NEW_PASSWORD = 'clave-nueva-456';

const me = (token: string) =>
  request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

describe('POST /api/auth/change-password', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('requires a session on top of the current password', async () => {
    const res = await request(app)
      .post(CHANGE)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('answers 400, not 401, to a wrong current password, and revokes nothing', async () => {
    // 400 on purpose: on a 401 outside login the web client drops the token
    // and logs out, and a typo in the current password does not deserve that.
    const otherDevice = await createTestToken(user);

    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-this-one', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La contraseña actual es incorrecta' });
    expect((await me(otherDevice)).status).toBe(200);
  });

  it('rejects a new password equal to the current one', async () => {
    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'corta' });

    expect(res.status).toBe(400);
  });

  it('keeps the session that made the change and revokes every other one', async () => {
    // A user of its own, so the other tests keep their credentials.
    const victim = await clinic.createUser();
    const current = await createTestToken(victim);
    const otherDevice = await createTestToken(victim);

    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${current}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    expect((await me(current)).status).toBe(200);
    expect((await me(otherDevice)).status).toBe(401);

    // password_changed_at is no longer stamped (sessions replaced it).
    const row = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(row.passwordChangedAt).toBeNull();

    // And login reflects the change: the new password works, the old one not.
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ email: victim.email, password: NEW_PASSWORD });
    expect(loginNew.status).toBe(200);

    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ email: victim.email, password: TEST_PASSWORD });
    expect(loginOld.status).toBe(401);
  });
});
