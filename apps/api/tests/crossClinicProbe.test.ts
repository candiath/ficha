import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { buildProbeWorld, clinicState, deleteProbeWorld, probeParam, probeRequest, type ProbeWorld } from './probeWorld';
import { fillPath, routeInventory, type Route } from './routeInventory';

// Every clinic route with an id in its path, called by an ADMIN of clinic A
// with ids that are not hers to use, in three passes:
//   1. every id from clinic B;
//   2. her own patient, with clinic B's ids for everything under the patient;
//   3. her own patient, with another patient's ids of her own clinic.
// Each call must answer 404 (or 400 where listed below), leave the other
// clinic's or patient's rows as they were, and name none of their ids or
// texts. Passes 2 and 3 reach past requireLivePatient, into each repository's
// own scoping. A new route with a param no probe knows fails here until
// probeWorld.ts gives it an id.
//
// The probe sends an empty body: it proves isolation for the lookups a route
// makes before validating the body. Ids in a body are covered route by route
// in tenantIsolation.test.ts and each route's own tests.

// Routes that validate the body before looking anything up: an empty body is
// a 400 before the lookup, so the probe proves nothing about them. Listed so
// that a new one is acknowledged; each is covered by its own tests.
const BODY_FIRST: Record<string, string> = {
  'PATCH /api/patients/:id': 'reason is required; patientRepository.test.ts covers a foreign or deleted patient.',
};

// Routes that validate the body first, probed with a valid one so the lookup
// runs: each must then answer 404.
const VALID_BODY: Record<string, object> = {
  'PATCH /api/users/:id': { isActive: true },
  'PATCH /api/patients/:patientId/sessions/:sessionId': {
    expectedVersion: 1,
    reason: 'DATA_ENTRY_ERROR',
    observations: 'Sonda',
  },
  'POST /api/patients/:patientId/sessions/:sessionId/annul': { reason: 'DATA_ENTRY_ERROR' },
  'PATCH /api/patients/:patientId/events/:eventId': {
    expectedVersion: 1,
    reason: 'DATA_ENTRY_ERROR',
    description: 'Sonda',
  },
  'POST /api/patients/:patientId/events/:eventId/annul': { reason: 'DATA_ENTRY_ERROR' },
};

// Routes that answer another clinic's id with an empty 200 instead of a 404,
// by decision; the probe still checks they leak and write nothing.
const EMPTY_200: Record<string, string> = {
  'GET /api/patients/:patientId/audit-log': '"No history" and "does not exist" get the same answer (auditLog.test.ts).',
};

const inventory = routeInventory();
const probed = inventory.routes.filter((r) => r.path.includes(':') && !r.path.startsWith('/api/platform'));
// Passes 2 and 3: the routes under a patient that name something of hers by
// id (a version number alone names her own record's).
const nested = probed.filter(
  (r) => r.path.startsWith('/api/patients/:patientId/') && /:(?!patientId|version)\w+/.test(r.path),
);

describe('cross-clinic probe over every route with an id in its path', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let tokenA: string;
  let a: ProbeWorld;
  let a2: ProbeWorld;
  let b: ProbeWorld;

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    tokenA = await createTestToken(await clinicA.createUser({ role: 'ADMIN' }));
    a = await buildProbeWorld(clinicA, 'Propia');
    a2 = await buildProbeWorld(clinicA, 'Vecina');
    b = await buildProbeWorld(clinicB, 'Ajena');
  });

  afterAll(async () => {
    await sleep(300);
    await deleteProbeWorld(clinicA);
    await deleteProbeWorld(clinicB);
  });

  // One call per route: a description of what is wrong with its answer, or null.
  async function probe(r: Route, ids: (param: string) => string | undefined, secrets: string[]): Promise<string | null> {
    const url = fillPath(r.path, ids)!;
    const res = await probeRequest(app, r.method, url, tokenA, VALID_BODY[r.key]);
    const leaked = secrets.filter((s) => res.text.includes(s));
    const refused =
      res.status === 404 ||
      (res.status === 400 && r.key in BODY_FIRST) ||
      (res.status === 200 && r.key in EMPTY_200);
    if (refused && leaked.length === 0) return null;
    return `${r.key} → ${res.status}${leaked.length ? ` leaks ${leaked.join(', ')}` : ''}`;
  }

  async function pass(routes: Route[], ids: (r: Route, param: string) => string | undefined, secrets: string[]) {
    const wrong: string[] = [];
    for (const r of routes) {
      const result = await probe(r, (p) => ids(r, p), secrets);
      if (result) wrong.push(result);
    }
    return wrong;
  }

  it('reads every route, and has an id for every param', () => {
    expect(inventory.literals, 'route calls without a literal path').toBe(inventory.calls);
    expect(inventory.unmounted, 'route files with no mount in app.ts').toEqual([]);
    expect(inventory.unexpanded, 'nested routers routeInventory.ts does not expand').toEqual([]);
    expect(probed.length).toBeGreaterThan(30);
    expect(nested.length).toBeGreaterThan(15);
    const unknown = probed.filter((r) => fillPath(r.path, (p) => probeParam(b, r.path, p)) === null).map((r) => r.key);
    expect(unknown, 'routes whose params probeWorld.ts does not know').toEqual([]);
    const keys = new Set(probed.map((r) => r.key));
    const listed = [...Object.keys(BODY_FIRST), ...Object.keys(VALID_BODY), ...Object.keys(EMPTY_200)];
    expect(listed.filter((k) => !keys.has(k))).toEqual([]);
  });

  it("refuses clinic B's ids on every route, writes nothing and leaks nothing", async () => {
    const before = await clinicState(clinicB.tenantId);
    expect(await pass(probed, (r, p) => probeParam(b, r.path, p), b.secrets)).toEqual([]);
    await sleep(200);
    expect(await clinicState(clinicB.tenantId)).toBe(before);
  });

  it("refuses clinic B's ids under her own patient", async () => {
    const before = await clinicState(clinicB.tenantId);
    const ids = (r: Route, p: string) => (p === 'patientId' ? a.patientId : probeParam(b, r.path, p));
    expect(await pass(nested, ids, b.secrets)).toEqual([]);
    await sleep(200);
    expect(await clinicState(clinicB.tenantId)).toBe(before);
  });

  it("refuses another patient's ids of her own clinic under a patient's path", async () => {
    const before = await clinicState(clinicA.tenantId);
    const ids = (r: Route, p: string) => (p === 'patientId' ? a.patientId : probeParam(a2, r.path, p));
    expect(await pass(nested, ids, a2.secrets)).toEqual([]);
    await sleep(200);
    expect(await clinicState(clinicA.tenantId)).toBe(before);
  });
});
