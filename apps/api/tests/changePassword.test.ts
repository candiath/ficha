import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { createTestClinic, signTestToken, TEST_PASSWORD, type TestClinic } from './helpers';

const CHANGE = '/api/auth/change-password';
const NEW_PASSWORD = 'clave-nueva-456';

describe('POST /api/auth/change-password', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('sin token responde 401 (exige sesión además de la contraseña actual)', async () => {
    const res = await request(app)
      .post(CHANGE)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('con la contraseña actual incorrecta responde 400, no 401', async () => {
    // 400 a propósito: ante un 401 fuera del login el cliente web borra el
    // token y cierra la sesión, y un typo en la contraseña no amerita eso.
    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'no-es-esta', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La contraseña actual es incorrecta' });
  });

  it('rechaza que la contraseña nueva sea igual a la actual', async () => {
    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('rechaza una contraseña nueva de menos de 8 caracteres', async () => {
    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'corta' });

    expect(res.status).toBe(400);
  });

  it('el cambio exitoso rota el token e invalida las sesiones anteriores', async () => {
    // Usuario propio para no afectar las credenciales de los otros tests.
    const victim = await clinic.createUser();
    // Sesión "vieja en otro dispositivo": un token emitido segundos antes
    // del cambio (la resolución de iat es en segundos, por eso el -5).
    const oldDeviceToken = signTestToken(victim, { iatOffsetSeconds: -5 });

    const res = await request(app)
      .post(CHANGE)
      .set('Authorization', `Bearer ${signTestToken(victim)}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(200);
    const newToken = res.body.data.token;
    expect(newToken).toBeTruthy();
    expect(Object.keys(res.body.data)).toEqual(['token']);

    // La sesión vieja quedó revocada; la nueva (el token devuelto) funciona.
    const oldSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldDeviceToken}`);
    expect(oldSession.status).toBe(401);

    const newSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${newToken}`);
    expect(newSession.status).toBe(200);
    expect(newSession.body.data.id).toBe(victim.id);

    // Y el login refleja el cambio: la nueva entra, la vieja ya no.
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
