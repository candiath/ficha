import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// PUT de técnicas sobre una sesión inexistente: el repo devuelve null y la
// ruta responde 404. Antes el repo tiraba un Error genérico que el
// errorHandler convertía en 500.
describe('PUT /api/patients/:patientId/sessions/:sessionId/techniques', () => {
  let clinic: TestClinic;
  let token: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    const user = await clinic.createUser();
    token = signTestToken(user);
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('responde 404 si la sesión no existe', async () => {
    const res = await request(app)
      .put(`/api/patients/${randomUUID()}/sessions/${randomUUID()}/techniques`)
      .set('Authorization', `Bearer ${token}`)
      .send({ entries: [] });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });
});
