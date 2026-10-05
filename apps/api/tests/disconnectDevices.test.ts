import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { createTestClinic, createTestToken, TEST_PASSWORD, type TestClinic } from './helpers';

// Disconnecting every device of a user without deactivating her
// (docs/specs/SPEC-admin-revocation.md).

const me = (token: string) =>
  request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

describe('ADMIN disconnects a user’s devices', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let admin: User;
  let adminToken: string;

  const disconnect = (userId: string, token = adminToken) =>
    request(app)
      .post(`/api/users/${userId}/disconnect-devices`)
      .set('Authorization', `Bearer ${token}`);

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

  it('closes every session of the user, and only hers', async () => {
    const therapist = await clinic.createUser();
    const colleague = await clinic.createUser();
    const phone = await createTestToken(therapist);
    const laptop = await createTestToken(therapist, { trusted: true });
    const colleagueToken = await createTestToken(colleague);

    const res = await disconnect(therapist.id);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect((await me(phone)).status).toBe(401);
    expect((await me(laptop)).status).toBe(401);
    expect((await me(adminToken)).status).toBe(200);
    expect((await me(colleagueToken)).status).toBe(200);
  });

  it('keeps the account: she can log in again', async () => {
    const therapist = await clinic.createUser();
    await createTestToken(therapist);

    await disconnect(therapist.id);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: therapist.email, password: TEST_PASSWORD });

    expect(login.status).toBe(200);
    expect((await me(login.body.data.token)).status).toBe(200);
  });

  it('a user without open sessions is still a 204', async () => {
    const therapist = await clinic.createUser();

    expect((await disconnect(therapist.id)).status).toBe(204);
  });

  it('a user of another clinic is a 404 and keeps her sessions', async () => {
    const foreign = await other.createUser();
    const foreignToken = await createTestToken(foreign);

    const res = await disconnect(foreign.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
    expect((await me(foreignToken)).status).toBe(200);
  });

  it('a nonexistent user is a 404', async () => {
    const res = await disconnect('0199a8f0-0000-7000-8000-000000000000');

    expect(res.status).toBe(404);
  });

  it('her own devices are a 400 pointing to Mi cuenta, and nothing is closed', async () => {
    const res = await disconnect(admin.id);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Para desconectar tus propios dispositivos usá Mi cuenta' });
    expect((await me(adminToken)).status).toBe(200);
  });

  it('a THERAPIST cannot do it', async () => {
    const therapist = await clinic.createUser();
    const target = await clinic.createUser();
    const targetToken = await createTestToken(target);

    const res = await disconnect(target.id, await createTestToken(therapist));

    expect(res.status).toBe(403);
    expect((await me(targetToken)).status).toBe(200);
  });
});
