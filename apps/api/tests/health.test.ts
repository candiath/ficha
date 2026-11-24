import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';

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

describe('GET /health/live', () => {
  it('answers ok without touching the database', async () => {
    const ping = vi.spyOn(prisma, '$queryRaw');
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(ping).not.toHaveBeenCalled();
    ping.mockRestore();
  });
});
