import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import {
  createTestClinic,
  createTestOperator,
  signOperatorTestToken,
  createTestToken,
  type TestClinic,
  type TestOperator,
} from './helpers';

// The border between the platform operator and the clinic app, both ways. An
// operator token opens no clinic route — not even the most harmless — and a
// clinic session opens no platform route. It is not enough that nobody tries
// today: forged tokens with the right shape and the wrong secret are tried
// too. The two kinds cannot overlap: clinic tokens are opaque session ids,
// operator tokens are JWTs.
describe('aislamiento operador ↔ clínica', () => {
  let clinic: TestClinic;
  let admin: User;
  let userToken: string;
  let op: TestOperator;

  const CLINIC_ROUTES = ['/api/auth/me', '/api/patients', '/api/users', '/api/tenant', '/api/alerts/stats'];
  const PLATFORM_ROUTES = ['/api/platform/auth/me', '/api/platform/tenants'];

  beforeAll(async () => {
    clinic = await createTestClinic();
    admin = await clinic.createUser({ role: 'ADMIN' });
    userToken = await createTestToken(admin);
    op = await createTestOperator();
  });

  afterAll(async () => {
    await op.cleanup();
    await clinic.cleanup();
  });

  it('un token de operador recibe 401 en todas las rutas de la clínica', async () => {
    for (const path of CLINIC_ROUTES) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${op.token}`);
      expect(res.status, path).toBe(401);
    }
  });

  it('un token de usuario recibe 401 en todas las rutas de plataforma', async () => {
    for (const path of PLATFORM_ROUTES) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${userToken}`);
      expect(res.status, path).toBe(401);
    }
  });

  // An operator-shaped token signed with any other secret: the platform
  // middleware rejects the signature, and the clinic never accepts a JWT at
  // all (its tokens are opaque sessions).
  it('an operator token signed with another secret opens nothing', async () => {
    const forged = signOperatorTestToken(op.operator.id, {
      secret: 'another-secret-of-at-least-32-characters!',
    });

    expect((await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  // User shape, platform secret: the platform rejects it by shape (tenantId),
  // and the clinic because a JWT is not a session token, whatever its sub.
  it('un token de usuario firmado con PLATFORM_JWT_SECRET no entra en ningún lado', async () => {
    const forged = jwt.sign(
      { tenantId: clinic.tenantId },
      process.env.PLATFORM_JWT_SECRET as string,
      { subject: admin.id, expiresIn: '1h' },
    );

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    expect((await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  // El sub de un token de operador es un id de platform_operators. Si además
  // trae tenantId y kind, el middleware de plataforma lo rechaza por forma
  // aunque la firma sea la suya: un token con tenantId es de clínica.
  it('el middleware de plataforma rechaza un token con tenantId aunque la firma sea la suya', async () => {
    const mixed = jwt.sign(
      { kind: 'platform', tenantId: clinic.tenantId },
      process.env.PLATFORM_JWT_SECRET as string,
      { subject: op.operator.id, expiresIn: '1h' },
    );

    const res = await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${mixed}`);
    expect(res.status).toBe(401);
  });

  it('sin token, las rutas de plataforma responden el mismo 401 que las de la clínica', async () => {
    const res = await request(app).get('/api/platform/tenants');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('una ruta de plataforma inexistente es 404, no un 401 confuso', async () => {
    const res = await request(app).get('/api/platform/no-existe').set('Authorization', `Bearer ${op.token}`);
    expect(res.status).toBe(404);
  });
});
