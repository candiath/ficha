import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app';

// Estos tests corren con NODE_ENV=test (lo fija setup.ts), así que rige la
// política de CORS de desarrollo: localhost y red local permitidos. La regla
// de producción (solo CORS_ORIGIN, y explotar si falta) es de arranque y no
// se puede probar acá sin reimportar la app con otro entorno.
describe('headers de seguridad y CORS', () => {
  it('toda respuesta lleva los headers de helmet y no anuncia el framework', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('permite el origen de desarrollo del frontend', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('no emite headers CORS para un origen ajeno', async () => {
    // Sin Access-Control-Allow-Origin el navegador bloquea la lectura de la
    // respuesta: esto es lo que dejó de permitir el fin del wildcard
    // *.netlify.app (cualquier sitio hosteado ahí podía llamar a la API).
    const res = await request(app).get('/health').set('Origin', 'https://evil.netlify.app');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde el preflight OPTIONS para un origen permitido', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
