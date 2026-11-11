import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { buildProbeWorld, clinicState, deleteProbeWorld, probeParam, probeRequest, type ProbeWorld } from './probeWorld';
import { fillPath, routeInventory } from './routeInventory';

// Every clinic route with an id in its path, called by an ADMIN of clinic A
// with the ids of clinic B's rows: each answers 400 or 404, names nothing of
// B's, and B's rows are the same afterwards. A new route with a param no
// probe knows fails here until probeWorld.ts gives it an id.
//
// Ids in a body are covered route by route in tenantIsolation.test.ts and
// each route's own tests.
// Routes that answer another clinic's id with an empty 200 instead of a 404,
// by decision; the probe still checks they leak and write nothing.
const EMPTY_200: Record<string, string> = {
  'GET /api/patients/:patientId/audit-log': '"No history" and "does not exist" get the same answer (auditLog.test.ts).',
};

const { routes } = routeInventory();
const probed = routes.filter((r) => r.path.includes(':') && !r.path.startsWith('/api/platform'));

describe('cross-clinic probe over every route with an id in its path', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let tokenA: string;
  let b: ProbeWorld;

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    tokenA = await createTestToken(await clinicA.createUser({ role: 'ADMIN' }));
    await buildProbeWorld(clinicA, 'Propia');
    b = await buildProbeWorld(clinicB, 'Ajena');
  });

  afterAll(async () => {
    await sleep(300);
    await deleteProbeWorld(clinicA);
    await deleteProbeWorld(clinicB);
  });

  it('has routes to probe, and an id for every param', () => {
    expect(probed.length).toBeGreaterThan(30);
    const unknown = probed.filter((r) => fillPath(r.path, (p) => probeParam(b, r.path, p)) === null).map((r) => r.key);
    expect(unknown, 'routes whose params probeWorld.ts does not know').toEqual([]);
  });

  it("refuses clinic B's ids on every route, writes nothing and leaks nothing", async () => {
    const before = await clinicState(clinicB.tenantId);
    const secrets = [...Object.values(b).filter((v) => v.length > 8), 'Ajena'];
    const wrong: string[] = [];

    for (const r of probed) {
      const url = fillPath(r.path, (p) => probeParam(b, r.path, p))!;
      const res = await probeRequest(app, r.method, url, tokenA);
      const leaked = secrets.filter((s) => res.text.includes(s));
      const refused = [400, 404].includes(res.status) || (res.status === 200 && r.key in EMPTY_200);
      if (!refused || leaked.length > 0) {
        wrong.push(`${r.key} → ${res.status}${leaked.length ? ` leaks ${leaked.join(', ')}` : ''}`);
      }
    }

    expect(wrong).toEqual([]);
    await sleep(200);
    expect(await clinicState(clinicB.tenantId)).toBe(before);
  });
});
