import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app';

// Smoke test de la infraestructura: si esto pasa, la app se importa sin
// levantar puerto, el .env se cargó y la conexión a la DB funciona.
describe('GET /health', () => {
  it('responde ok con la DB disponible', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    // TODO(human): asegurar que /health expone la marca de build.
    // El body ahora es { status, buildMarker }, asi que el toEqual exacto
    // que habia aca ya no sirve. Decidi que tan estricto queres ser.
    expect(res.body.buildMarker).toEqual(expect.any(String));
  });
});
