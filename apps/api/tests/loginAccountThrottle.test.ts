import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, TEST_PASSWORD, waitFor, type TestClinic } from './helpers';

const LOGIN = '/api/auth/login';
const THROTTLED = { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };

// El freno por cuenta existe para el atacante que rota IPs, así que acá cada
// request viene de una IP distinta: trust proxy hace que X-Forwarded-For sea
// req.ip, y el limiter por IP nunca llega a intervenir. Todo 429 que aparece
// en esta suite es del freno por cuenta.
//
// En archivo propio por la misma razón que loginRateLimit: acumula fallos
// que ninguna otra suite tiene por qué heredar.
//
// Timeout propio, por encima de los 15 s globales: cada test acumula diez
// intentos o más, y cada intento son tres viajes a Neon (el freno, el
// usuario y el registro del fallo, que se espera) más un bcrypt. Desde los
// runners de GitHub eso ronda el segundo por intento; la primera versión
// de esta suite, con un test de 21 intentos, se pasó del límite en CI.
describe('freno por cuenta de POST /api/auth/login', { timeout: 45_000 }, () => {
  let clinic: TestClinic;
  // La suite entera hace menos de 255 requests, así que alcanza un octeto.
  let nextIp = 1;

  function login(email: string, password: string) {
    return request(app)
      .post(LOGIN)
      .set('X-Forwarded-For', `10.0.0.${nextIp++}`)
      .send({ email, password });
  }

  async function fail(email: string, times: number) {
    for (let i = 1; i <= times; i++) {
      const res = await login(email, 'contraseña-incorrecta');
      expect(res.status, `fallo ${i} contra ${email}`).toBe(401);
    }
  }

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  describe('diez fallos seguidos desde IPs distintas', () => {
    let user: User;

    beforeAll(async () => {
      user = await clinic.createUser();
      await fail(user.email, 10);
    });

    it('frenan la cuenta aunque la IP sea nueva y la contraseña, la correcta', async () => {
      const res = await login(user.email, TEST_PASSWORD);

      expect(res.status).toBe(429);
      expect(res.body).toEqual(THROTTLED);
    });

    it('no registran los intentos que el freno rechaza', async () => {
      // Si contaran, un request cada quince minutos bastaría para mantener
      // la cuenta cerrada indefinidamente.
      await login(user.email, TEST_PASSWORD);

      const count = await prisma.loginEvent.count({ where: { email: user.email } });
      expect(count).toBe(10);
    });
  });

  it('frena igual a un email que no existe: el 429 no delata qué cuentas hay', async () => {
    const fantasma = clinic.email('fantasma');
    await fail(fantasma, 10);

    const res = await login(fantasma, 'lo-que-sea');

    expect(res.status).toBe(429);
    expect(res.body).toEqual(THROTTLED);
  });

  it('un login exitoso corta la racha', async () => {
    const user = await clinic.createUser();
    await fail(user.email, 9);

    const ok = await login(user.email, TEST_PASSWORD);
    expect(ok.status).toBe(200);
    // El registro del éxito es fire-and-forget: esperar a que aterrice
    // antes de seguir, para que quede ordenado antes del fallo nuevo.
    await waitFor(() => prisma.loginEvent.findFirst({ where: { email: user.email, success: true } }));

    // Un fallo más: diez en la ventana, pero solo uno seguido desde el éxito.
    await fail(user.email, 1);

    // Éste es el que distingue las dos semánticas. Si el freno contara
    // "diez fallos en la ventana", acá habría 429; como mira "los últimos
    // diez intentos, todos fallidos", el éxito en el medio lo desarma.
    const res = await login(user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);
  });
});
