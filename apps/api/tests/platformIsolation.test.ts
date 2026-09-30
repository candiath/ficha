import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import {
  createTestClinic,
  createTestOperator,
  signOperatorTestToken,
  signTestToken,
  type TestClinic,
  type TestOperator,
} from './helpers';

// La frontera entre el operador de plataforma y la app clínica, en las dos
// direcciones. Un token de operador no abre ninguna ruta de clínica —ni la
// más inocente— y un token de usuario no abre ninguna de plataforma. Y no
// alcanza con que hoy nadie lo intente: se prueba también con tokens
// fabricados con la forma correcta y el secreto equivocado, y al revés.
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
    userToken = signTestToken(admin);
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

  // Forma de operador, secreto de la clínica: la firma es válida para
  // authenticate, pero la forma no (sin tenantId). Y para el middleware de
  // plataforma la firma es inválida. Cae en los dos lados.
  it('un token de operador firmado con JWT_SECRET no entra en ningún lado', async () => {
    const forged = signOperatorTestToken(op.operator.id, {
      secret: process.env.JWT_SECRET as string,
    });

    expect((await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  // Forma de usuario, secreto de plataforma: ídem al revés. Y aunque el
  // sub sea un usuario real, la clínica lo rechaza por firma.
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
