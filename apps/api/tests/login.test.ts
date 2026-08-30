import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, TEST_PASSWORD, waitFor, type TestClinic } from './helpers';

const LOGIN = '/api/auth/login';

// Ojo con el presupuesto: el rate limiter admite 10 requests a /login por
// archivo (la app se importa fresca en cada archivo y el store es en
// memoria). Esta suite usa 6. El 429 se prueba aparte, en su propio archivo.
describe('POST /api/auth/login', () => {
  let clinic: TestClinic;
  let user: User;
  let inactive: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    inactive = await clinic.createUser({ isActive: false });
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('con credenciales válidas devuelve token y usuario, sin campos sensibles', async () => {
    const res = await request(app)
      .post(LOGIN)
      .set('User-Agent', 'ficha-tests')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    // Ni passwordHash ni tenantId ni nada extra: exactamente estas claves.
    expect(Object.keys(res.body.data.user).sort()).toEqual(['email', 'id', 'name', 'role']);

    // El token emitido sirve de verdad contra una ruta protegida.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(user.id);
  });

  it('password incorrecta, email inexistente y usuario inactivo responden 401 idénticos', async () => {
    // Anti-enumeración: si alguna variante respondiera distinto, un atacante
    // podría averiguar qué emails tienen cuenta (o cuáles están desactivados).
    const [wrongPassword, unknownEmail, inactiveUser] = [
      await request(app).post(LOGIN).send({ email: user.email, password: 'incorrecta' }),
      await request(app).post(LOGIN).send({ email: clinic.email('fantasma'), password: TEST_PASSWORD }),
      await request(app).post(LOGIN).send({ email: inactive.email, password: TEST_PASSWORD }),
    ];

    for (const res of [wrongPassword, unknownEmail, inactiveUser]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
    }
  });

  it('normaliza el email a minúsculas antes de buscar la cuenta', async () => {
    const res = await request(app)
      .post(LOGIN)
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('un email con formato inválido responde 400', async () => {
    const res = await request(app)
      .post(LOGIN)
      .send({ email: 'esto-no-es-un-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  // Las escrituras de telemetría son fire-and-forget (no demoran el login),
  // por eso se esperan con waitFor en vez de asumir que ya aterrizaron.

  it('registra el login exitoso en login_events con IP y user-agent', async () => {
    // orderBy explícito: esta suite hace DOS logins exitosos con el mismo
    // email (el primer test, que manda User-Agent, y el de normalización a
    // minúsculas, que no). Sin ORDER BY, Postgres puede devolver cualquiera
    // de las dos filas y el assert del user-agent falla de forma
    // intermitente. El evento que interesa es el del primer login.
    const event = await waitFor(() =>
      prisma.loginEvent.findFirst({
        where: { email: user.email, success: true },
        orderBy: { createdAt: 'asc' },
      }),
    );

    expect(event.userId).toBe(user.id);
    expect(event.tenantId).toBe(clinic.tenantId);
    expect(event.ip).toBeTruthy();
    expect(event.userAgent).toBe('ficha-tests');
  });

  it('registra el intento fallido de un email desconocido sin tenant ni usuario', async () => {
    const event = await waitFor(() =>
      prisma.loginEvent.findFirst({ where: { email: clinic.email('fantasma'), success: false } }),
    );

    expect(event.userId).toBeNull();
    expect(event.tenantId).toBeNull();
  });

  it('registra el intento fallido contra una cuenta real atribuido a esa cuenta', async () => {
    const event = await waitFor(() =>
      prisma.loginEvent.findFirst({ where: { email: user.email, success: false } }),
    );

    expect(event.userId).toBe(user.id);
    expect(event.tenantId).toBe(clinic.tenantId);
  });

  it('actualiza lastLoginAt tras un login exitoso', async () => {
    // El usuario se creó sin lastLoginAt; el login del primer test debió setearlo.
    const updated = await waitFor(async () => {
      const u = await prisma.user.findUnique({ where: { id: user.id } });
      return u?.lastLoginAt ? u : null;
    });

    expect(updated.lastLoginAt).toBeInstanceOf(Date);
  });
});
