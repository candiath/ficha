import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { createTestClinic, TEST_PASSWORD, type TestClinic } from './helpers';

// El login responde el mismo mensaje para email inexistente, usuario
// desactivado y contraseña incorrecta — pero el TIEMPO los distinguía. La
// expresión encadenada cortocircuitaba, así que bcrypt no llegaba a correr
// cuando el email no existía: 67 ms medidos contra 0. Un atacante prueba una
// lista de emails con cualquier contraseña y separa los que tienen cuenta
// (issue #71).
//
// Se testea la propiedad estructural —bcrypt corre en los dos caminos— y no
// el tiempo. Medirlo sería flaky en CI, y acá encima daría al revés: los
// usuarios de prueba se hashean con cost 4 para que las suites sean rápidas,
// mientras que el hash señuelo usa cost 10 como las contraseñas reales.
describe('login: el tiempo no delata si el email existe', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function login(email: string, password: string) {
    return request(app).post('/api/auth/login').send({ email, password });
  }

  // El corazón del arreglo: sin usuario que comparar, bcrypt corre igual
  // contra un hash señuelo.
  it('corre bcrypt aunque el email no exista', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');

    const res = await login(clinic.email('fantasma'), 'lo-que-sea');

    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('corre bcrypt cuando el email existe y la contraseña está mal', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');

    const res = await login(user.email, 'contraseña-incorrecta');

    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // Los tres caminos de rechazo tienen que ser indistinguibles desde afuera:
  // mismo status y mismo mensaje, además del mismo trabajo.
  it('los tres rechazos responden exactamente lo mismo', async () => {
    const inactivo = await clinic.createUser({ isActive: false });

    const respuestas = await Promise.all([
      login(clinic.email('no-existe'), 'x'),
      login(user.email, 'contraseña-incorrecta'),
      login(inactivo.email, TEST_PASSWORD),
    ]);

    for (const res of respuestas) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
    }
  });

  it('el login válido sigue funcionando', async () => {
    const res = await login(user.email, TEST_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
  });
});
