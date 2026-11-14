import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { buildProbeWorld, clinicState, deleteProbeWorld, probeParam, probeRequest, type ProbeWorld } from './probeWorld';
import { fillPath, routeInventory } from './routeInventory';

// Every route of a patient's record answers 404 once she is deleted, and
// writes nothing (requireLivePatient, CLAUDE.md "Borrado de pacientes"). The
// routes are read from the source, so a new one is probed without being
// listed here.
const EXCEPT: Record<string, string> = {
  'GET /api/patients/:patientId/audit-log': "A deleted patient's history stays readable.",
  'POST /api/patients/:id/restore': 'Undoes the deletion: it exists for a deleted patient.',
};
// Routes that validate the body before looking the patient up, so an empty
// probe body is a 400; their write still requires a live patient in its where.
const BODY_FIRST = new Set(['PATCH /api/patients/:id']);

const { routes } = routeInventory();
const record = routes.filter(
  (r) => /^\/api\/patients\/:(patientId|id)(\/|$)/.test(r.path) && !(r.key in EXCEPT),
);

describe('a deleted patient’s record answers 404 on every route', () => {
  let clinic: TestClinic;
  let token: string;
  let world: ProbeWorld;

  beforeAll(async () => {
    clinic = await createTestClinic();
    token = await createTestToken(await clinic.createUser({ role: 'ADMIN' }));
    world = await buildProbeWorld(clinic, 'Borrada');
    const res = await request(app).delete(`/api/patients/${world.patientId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  afterAll(async () => {
    await sleep(300);
    await deleteProbeWorld(clinic);
  });

  it('probes the record’s routes, and every exception is a route', () => {
    expect(record.length).toBeGreaterThan(25);
    const keys = new Set(routes.map((r) => r.key));
    expect(Object.keys(EXCEPT).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('answers 404 and writes nothing', async () => {
    const before = await clinicState(clinic.tenantId);
    const wrong: string[] = [];

    for (const r of record) {
      const url = fillPath(r.path, (p) => probeParam(world, r.path, p))!;
      const res = await probeRequest(app, r.method, url, token);
      const ok = res.status === 404 || (res.status === 400 && BODY_FIRST.has(r.key));
      if (!ok) wrong.push(`${r.key} → ${res.status}`);
    }

    expect(wrong).toEqual([]);
    await sleep(200);
    expect(await clinicState(clinic.tenantId)).toBe(before);
  });
});
