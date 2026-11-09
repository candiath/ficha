import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';

// The build version the web compares with its own on every response, to tell
// when it is out of step with this API (apps/web/src/lib/buildVersion.ts).
describe('X-Build-Version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is sent on every response, exposed to the web, and reported by /health', async () => {
    vi.stubEnv('FICHA_BUILD_VERSION', '1762700000');

    const health = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    const refused = await request(app).get('/api/patients');

    expect(health.headers['x-build-version']).toBe('1762700000');
    expect(health.headers['access-control-expose-headers']).toContain('X-Build-Version');
    expect(health.body.buildVersion).toBe('1762700000');
    expect(refused.status).toBe(401);
    expect(refused.headers['x-build-version']).toBe('1762700000');
  });

  it('is left out without a version (dev server, tests), so the web does no check', async () => {
    vi.stubEnv('FICHA_BUILD_VERSION', '');

    const res = await request(app).get('/health');

    expect(res.headers['x-build-version']).toBeUndefined();
    expect(res.body.buildVersion).toBeNull();
  });

  it('ignores a version that is not a commit time', async () => {
    vi.stubEnv('FICHA_BUILD_VERSION', 'abc1234');

    const res = await request(app).get('/health');

    expect(res.headers['x-build-version']).toBeUndefined();
  });
});
