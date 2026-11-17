import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import {
  createTestClinic,
  createTestOperator,
  createTestToken,
  TEST_PASSWORD,
  type TestClinic,
  type TestOperator,
} from './helpers';

// The border between the platform operator and the clinic app, both ways. An
// operator token opens no clinic route — not even the most harmless — and a
// clinic session opens no platform route. Both kinds are opaque tokens of 256
// random bits; isolation rests on the tables: an operator token is looked up
// only in platform_operator_sessions, a clinic token only in auth_sessions
// (SPEC-operator-sessions.md).
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

  // What a browser still holding a pre-encounters operator token sends after the
  // deploy: a JWT's shape, built by hand since the system signs none. It names
  // no row in either table.
  it('an old operator JWT opens nothing', async () => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const oldJwt = [
      part({ alg: 'HS256', typ: 'JWT' }),
      part({ kind: 'platform', sub: op.operator.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
      'c2lnbmF0dXJl',
    ].join('.');

    for (const path of [...PLATFORM_ROUTES, ...CLINIC_ROUTES]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${oldJwt}`);
      expect(res.status, path).toBe(401);
    }
  });

  // A token that came out of the real login, not a fixture: its session row
  // is in platform_operator_sessions only.
  it('a token from the operator login opens the platform and no clinic route', async () => {
    const login = await request(app)
      .post('/api/platform/auth/login')
      .send({ email: op.operator.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;

    expect((await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    for (const path of CLINIC_ROUTES) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(res.status, path).toBe(401);
    }
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
