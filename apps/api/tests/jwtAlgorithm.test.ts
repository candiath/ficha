import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { signTestToken, createTestClinic, type TestClinic } from './helpers';

// El algoritmo del token está fijado en HS256, al firmar y al verificar.
//
// Hoy no tapa un agujero abierto: jsonwebtoken 9 ya rechaza `alg: none` por su
// cuenta, y con secreto simétrico no hay clave pública que prestarse para una
// confusión de algoritmos. Lo que hace es cerrar la familia entera por
// adelantado — el día que se pase a claves asimétricas, no fijarlo es
// exactamente el bug que deja firmar tokens con la clave pública.
//
// Estos tests son los que impiden que el pin se caiga sin que nadie note nada,
// porque sacarlo no rompe ningún flujo normal.
describe('el token solo se acepta firmado con HS256', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('acepta el token normal', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signTestToken(user)}`);

    expect(res.status).toBe(200);
  });

  // El caso que el pin ataca de verdad: mismo secreto, otro algoritmo. Sin
  // `algorithms: ['HS256']` en la verificación, jsonwebtoken lo aceptaría.
  it('rechaza un token HS512 firmado con el mismo secreto', async () => {
    const token = jwt.sign(
      { tenantId: user.tenantId },
      process.env.JWT_SECRET as string,
      { subject: user.id, expiresIn: '1h', algorithm: 'HS512' },
    );

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rechaza un token sin firma (alg: none)', async () => {
    const token = jwt.sign({ tenantId: user.tenantId }, '', {
      subject: user.id,
      expiresIn: '1h',
      algorithm: 'none',
    });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
