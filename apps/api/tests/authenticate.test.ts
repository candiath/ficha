import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// El middleware corre en toda ruta protegida; /api/auth/me lo monta directo
// y es la sonda más simple: si me() responde, authenticate dejó pasar.
const ME = '/api/auth/me';

describe('middleware authenticate', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('sin header Authorization responde 401', async () => {
    const res = await request(app).get(ME);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('con un esquema que no es Bearer responde 401', async () => {
    const res = await request(app).get(ME).set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('con un token que no es un JWT responde 401', async () => {
    const res = await request(app).get(ME).set('Authorization', 'Bearer no-soy-un-jwt');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('con un token firmado con otro secreto responde 401', async () => {
    const forged = jwt.sign(
      { tenantId: clinic.tenantId },
      'secreto-equivocado-de-al-menos-32-caracteres!',
      { subject: user.id, expiresIn: '1h' },
    );

    const res = await request(app).get(ME).set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('con un token válido de un usuario que ya no existe responde 401', async () => {
    const token = signTestToken({ id: randomUUID(), tenantId: clinic.tenantId });

    const res = await request(app).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('un usuario desactivado recibe el mismo 401 que un token inválido', async () => {
    // Mismo mensaje a propósito: la respuesta no debe revelar que la cuenta
    // existe pero está desactivada.
    const inactive = await clinic.createUser({ isActive: false });
    const token = signTestToken(inactive);

    const res = await request(app).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('un token emitido antes del último cambio de contraseña responde 401', async () => {
    const victim = await clinic.createUser();
    const oldToken = signTestToken(victim, { iatOffsetSeconds: -5 });

    await prisma.user.update({
      where: { id: victim.id },
      data: { passwordChangedAt: new Date() },
    });

    const res = await request(app).get(ME).set('Authorization', `Bearer ${oldToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión expirada o inválida' });
  });

  it('un token emitido en el mismo segundo del cambio sigue valiendo', async () => {
    // iat tiene resolución de segundos: el token que devuelve change-password
    // se firma en el mismo segundo del cambio y no debe quedar invalidado.
    // Se fija passwordChangedAt 999ms después del iat real del token, dentro
    // del mismo segundo, para probar el borde exacto.
    const survivor = await clinic.createUser();
    const token = signTestToken(survivor);
    const { iat } = jwt.decode(token) as { iat: number };

    await prisma.user.update({
      where: { id: survivor.id },
      data: { passwordChangedAt: new Date(iat * 1000 + 999) },
    });

    const res = await request(app).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('con un token válido deja pasar y adjunta el usuario correcto', async () => {
    const token = signTestToken(user);

    const res = await request(app).get(ME).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  });
});
