import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';

// En archivo propio a propósito: cada archivo importa una app fresca con su
// rate limiter en cero, así el flood de acá no roba presupuesto a las demás
// suites (que usan /login con moderación).
describe('rate limit de POST /api/auth/login', () => {
  // Email inexistente: no hace falta crear usuarios para provocar intentos.
  const email = `rate-limit-${randomUUID().slice(0, 8)}@test.ficha.local`;

  afterAll(async () => {
    await prisma.loginEvent.deleteMany({ where: { email } });
  });

  it('devuelve 401 los primeros 10 intentos y 429 a partir del 11°', async () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'x' });
      expect(res.status, `intento ${attempt}`).toBe(401);
      // standardHeaders: el cliente puede saber cuánto presupuesto le queda.
      expect(res.headers['ratelimit-remaining']).toBeDefined();
    }

    const blocked = await request(app).post('/api/auth/login').send({ email, password: 'x' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: 'Demasiados intentos. Probá de nuevo en unos minutos.',
    });
  });
});
