import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app';

// Smoke test de la infraestructura: si esto pasa, la app se importa sin
// levantar puerto, el .env se cargó y la conexión a la DB funciona.
describe('GET /health', () => {
  it('responde ok con la DB disponible', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
