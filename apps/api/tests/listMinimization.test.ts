import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import app from '../src/app';
import { instantToClinicTime } from '../src/lib/clinicTime';
import { prisma } from '../src/lib/prisma';
import { LIST_SCOPE, type Shape } from './listScopeManifest';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';

// Global lists carry no clinical text (#186, docs/specs/SPEC-list-minimization.md
// §6). Two parts:
//
// - Inventory: every GET route is read from the source, as auditCoverage does
//   for writes, and is either under a patient's record or classified in
//   listScopeManifest.ts. A new GET without an entry fails here.
// - Probe: a clinic whose every String and Json column of the clinical models
//   holds a marker (taken from Prisma's schema, so a new column cannot be
//   missed). Each probed route must return the fixture's own rows (an empty
//   response cannot pass), carry no marker outside its allowed paths, and
//   match its pinned keys exactly, recursively.
//
// Numeric clinical columns (pain, evaScale, a scale's score) cannot hold a
// marker: the pinned keys are their guard.

// ─── Inventory ───────────────────────────────────────────────────────────────

const SRC = path.join(__dirname, '..', 'src');
const APP = path.join(SRC, 'app.ts');
const ROUTES = path.join(SRC, 'routes');

const GET_CALL = /\b(?:router|app)\.get\b/g;
const GET_ROUTE = /\b(?:router|app)\.get\s*(?:<[^()]*?>)?\(\s*'([^']*)'/g;
const MOUNT = /app\.use\(\s*'([^']*)'\s*,(?:[^;]*?,)?\s*(\w+Router)\s*\)/g;
const IMPORT = /import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g;

function getRoutes(source: string, prefixes: string[]): string[] {
  const keys: string[] = [];
  for (const [, route] of source.matchAll(GET_ROUTE)) {
    const relative = route === '/' ? '' : route.replace(/\/$/, '');
    for (const prefix of prefixes) keys.push(`GET ${prefix}${relative}`);
  }
  return keys;
}

function extract() {
  const appSource = readFileSync(APP, 'utf8');
  const fileOfRouter = new Map([...appSource.matchAll(IMPORT)].map(([, name, file]) => [name, `${file}.ts`]));
  const prefixesOfFile = new Map<string, string[]>();
  for (const [, prefix, router] of appSource.matchAll(MOUNT)) {
    const file = fileOfRouter.get(router);
    if (file) prefixesOfFile.set(file, [...(prefixesOfFile.get(file) ?? []), prefix]);
  }

  const keys = getRoutes(appSource, ['']);
  let calls = [...appSource.matchAll(GET_CALL)].length;
  let literals = [...appSource.matchAll(GET_ROUTE)].length;
  const unmounted: string[] = [];
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(path.join(ROUTES, file), 'utf8');
    const count = [...source.matchAll(GET_ROUTE)].length;
    calls += [...source.matchAll(GET_CALL)].length;
    literals += count;
    if (count > 0 && !prefixesOfFile.has(file)) unmounted.push(file);
    keys.push(...getRoutes(source, prefixesOfFile.get(file) ?? []));
  }
  return { keys, calls, literals, unmounted };
}

// The record itself: its routes may return clinical text.
const isPatientRecord = (key: string) =>
  key.startsWith('GET /api/patients/:patientId') || key === 'GET /api/patients/:id';

describe('every GET route is classified', () => {
  const { keys, calls, literals, unmounted } = extract();
  const outside = new Set(keys.filter((k) => !isPatientRecord(k)));

  it('the extraction did not go blind', () => {
    expect(literals, 'GET calls without a literal path').toBe(calls);
    expect(unmounted).toEqual([]);
    expect(keys.some(isPatientRecord)).toBe(true);
  });

  it('every GET outside a patient\'s record is in listScopeManifest.ts', () => {
    const missing = [...outside].filter((k) => !(k in LIST_SCOPE)).sort();
    expect(missing, 'GET routes outside the record with no entry').toEqual([]);
  });

  it('every manifest entry matches a route that exists', () => {
    const stale = Object.keys(LIST_SCOPE).filter((k) => !outside.has(k)).sort();
    expect(stale).toEqual([]);
  });

  it('every exemption has a reason', () => {
    const noReason = Object.entries(LIST_SCOPE)
      .filter(([, entry]) => entry.scope === 'exempt' && entry.reason.trim() === '')
      .map(([key]) => key);
    expect(noReason).toEqual([]);
  });
});

// ─── Probe ───────────────────────────────────────────────────────────────────

// Clinical by model (spec, "What counts as clinical text"). Every model with a
// patientId, or hanging from a clinical one, is classified here or below, so
// a new one has to be placed.
const CLINICAL_MODELS = [
  'PatientEvent',
  'ClinicalEpisode',
  'InitialEvaluation',
  'Session',
  'SessionEpisode',
  'FunctionalScale',
  'InformedConsent',
] as const;

const NOT_CLINICAL: Record<string, string> = {
  Appointment: 'Scheduling. Its notes leave the agenda\'s range anyway: they are marked below.',
  Payment: 'Money. Its notes are administrative (Decision 3).',
  SessionPackage: 'Money. Its name is administrative (Decision 3).',
  ClinicalAlert: 'Work to do. Engine messages carry no clinical text; custom ones are the user\'s (Decision 3).',
  AuditLog: 'Read only inside a patient\'s record (GET /api/patients/:patientId/audit-log).',
};

// Free text that is not clinical but must stay out of a list anyway.
const ALSO_MARKED: Record<string, string[]> = { Appointment: ['notes'] };

const models = Prisma.dmmf.datamodel.models;
const CLINICAL_RELATIONS = new Set<string>(['Session', 'InitialEvaluation', 'ClinicalEpisode']);

describe('every model that holds patient data is classified', () => {
  it('as clinical, or not with its reason', () => {
    const holding = models
      .filter(
        (m) =>
          m.name !== 'Patient' &&
          (m.fields.some((f) => f.name === 'patientId') ||
            m.fields.some((f) => f.kind === 'object' && CLINICAL_RELATIONS.has(f.type) && f.relationFromFields?.length)),
      )
      .map((m) => m.name);
    const classified = new Set<string>([...CLINICAL_MODELS, ...Object.keys(NOT_CLINICAL)]);

    expect(holding.filter((name) => !classified.has(name)).sort()).toEqual([]);
  });
});

const runId = randomUUID().replace(/-/g, '').slice(0, 4);
let markerCount = 0;
const markers: string[] = [];
// Short, ASCII and with no separators, so a truncated or quoted value still
// contains it.
function marker(): string {
  const value = `MK${runId}${(markerCount++).toString(36)}`;
  markers.push(value);
  return value;
}

// A marker in every String and Json column of the model that is not a key.
function marked(model: string, only?: string[]): Record<string, unknown> {
  const m = models.find((x) => x.name === model);
  if (!m) throw new Error(`no model ${model}`);
  const fields = m.fields.filter(
    (f) =>
      f.kind === 'scalar' &&
      (f.type === 'String' || f.type === 'Json') &&
      !f.isId &&
      !f.name.endsWith('Id') &&
      (!only || only.includes(f.name)),
  );
  return Object.fromEntries(fields.map((f) => [f.name, f.type === 'Json' ? { marker: marker() } : marker()]));
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Fixture {
  patientId: string;
  sessionId: string;
  appointmentId: string;
  paymentId: string;
  complaint: string;
}

// The keys of `value` against `shape`, recursively, on every array element.
// `seen` collects the nested paths that held a real object at least once, so
// a nullable relation the fixture forgot to fill cannot pass unchecked.
function shapeErrors(value: unknown, shape: Shape, at: string, seen: Set<string>): string[] {
  if (value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected an object`];
  seen.add(at);
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  const actual = Object.keys(record).sort();
  const expected = Object.keys(shape).sort();
  if (actual.join() !== expected.join()) {
    errors.push(`${at}: keys ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
  }
  for (const [key, sub] of Object.entries(shape)) {
    const child = record[key];
    if (sub === true) continue;
    if (Array.isArray(sub)) {
      if (!Array.isArray(child)) {
        errors.push(`${at}.${key}: expected an array`);
        continue;
      }
      for (const item of child) errors.push(...shapeErrors(item, sub[0], `${at}.${key}[]`, seen));
      if (child.length === 0) errors.push(`${at}.${key}: empty, so its items were never checked`);
    } else {
      errors.push(...shapeErrors(child, sub, `${at}.${key}`, seen));
    }
  }
  return errors;
}

// Every nested path a shape declares, to compare with what was seen.
function objectPaths(shape: Shape, at: string): string[] {
  return [
    at,
    ...Object.entries(shape).flatMap(([key, sub]) =>
      sub === true ? [] : Array.isArray(sub) ? objectPaths(sub[0], `${at}.${key}[]`) : objectPaths(sub, `${at}.${key}`),
    ),
  ];
}

// The body with the allowed paths blanked, before searching for markers. A
// path is keys and `[]` (every element): `pathologies[].name`, `[].referringDoctor`.
function withoutAllowed(data: unknown, allow: string[]): unknown {
  const copy: unknown = structuredClone(data);
  const blank = (node: unknown, tokens: string[]): void => {
    if (node === null || typeof node !== 'object' || tokens.length === 0) return;
    const [head, ...rest] = tokens;
    if (head === '[]') {
      if (Array.isArray(node)) for (const item of node) blank(item, rest);
      return;
    }
    const record = node as Record<string, unknown>;
    if (rest.length === 0) {
      if (head in record) record[head] = '<allowed>';
    } else {
      blank(record[head], rest);
    }
  };
  for (const allowed of allow) blank(copy, allowed.split('[]').join('.[].').split('.').filter(Boolean));
  return copy;
}

describe('global lists carry no clinical text', () => {
  let clinic: TestClinic;
  let token: string;
  let fixture: Fixture;
  let today: string;
  const createdClinicalModels = new Set<string>();

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    const user = await clinic.createUser({ role: 'ADMIN' });
    token = await createTestToken(user);
    const tenantId = clinic.tenantId;
    const { timezone } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    today = instantToClinicTime(new Date(), timezone).date;

    const patient = await prisma.patient.create({
      data: { tenantId, fullName: 'Paciente Sonda', referringDoctor: 'Dr. Derivante' },
      select: { id: true },
    });
    const patientId = patient.id;

    const episodeData = marked('ClinicalEpisode');
    const episode = await prisma.clinicalEpisode.create({
      data: { tenantId, patientId, status: 'ACTIVE', ...episodeData },
      select: { id: true },
    });
    createdClinicalModels.add('ClinicalEpisode');

    await prisma.initialEvaluation.create({
      data: { tenantId, patientId, episodeId: episode.id, ...(marked('InitialEvaluation') as object) },
    });
    createdClinicalModels.add('InitialEvaluation');

    // The patient's history (#238): a dated fact, with clinical text.
    await prisma.patientEvent.create({
      data: { tenantId, patientId, kind: 'FRACTURE', ...(marked('PatientEvent') as { description: string }) },
    });
    createdClinicalModels.add('PatientEvent');

    // Old enough for the engine: the episode has had no session for 40 days,
    // and the session's payment is overdue.
    const session = await prisma.session.create({
      data: {
        tenantId,
        patientId,
        userId: user.id,
        sessionDate: new Date(Date.now() - 40 * DAY_MS),
        // A session's clinical text is in its blocks (#238): marked too.
        episodes: {
          create: [{ episodeId: episode.id, painScaleBefore: 7, painScaleAfter: 3, ...marked('SessionEpisode') }],
        },
        ...marked('Session'),
      },
      select: { id: true },
    });
    createdClinicalModels.add('Session');
    createdClinicalModels.add('SessionEpisode');

    await prisma.functionalScale.create({
      data: {
        tenantId,
        patientId,
        scaleType: 'OSWESTRY',
        score: 42,
        ...(marked('FunctionalScale') as { responses: Prisma.InputJsonValue; interpretation: string }),
      },
    });
    createdClinicalModels.add('FunctionalScale');
    await prisma.informedConsent.create({ data: { tenantId, patientId, signed: true, signedAt: new Date() } });
    createdClinicalModels.add('InformedConsent');

    const pkg = await prisma.sessionPackage.create({
      data: { tenantId, patientId, name: 'Paquete Sonda', totalSessions: 10, pricePerSessionCents: 100 },
      select: { id: true },
    });
    const payment = await prisma.payment.create({
      data: {
        tenantId,
        patientId,
        sessionId: session.id,
        packageId: pkg.id,
        baseAmountCents: 100,
        finalAmountCents: 100,
        notes: 'Nota administrativa',
      },
      select: { id: true },
    });

    const startsAt = new Date();
    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        patientId,
        userId: user.id,
        episodeId: episode.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        ...marked('Appointment', ALSO_MARKED.Appointment),
      },
      select: { id: true },
    });

    fixture = {
      patientId,
      sessionId: session.id,
      appointmentId: appointment.id,
      paymentId: payment.id,
      complaint: episodeData.mainComplaint as string,
    };
  });

  afterAll(async () => {
    await sleep(300);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.appointment.deleteMany({ where });
    await prisma.clinicalAlert.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.sessionPackage.deleteMany({ where });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.initialEvaluation.deleteMany({ where });
    await prisma.functionalScale.deleteMany({ where });
    await prisma.informedConsent.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patientEvent.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('the fixture fills every clinical model', () => {
    expect([...createdClinicalModels].sort()).toEqual([...CLINICAL_MODELS].sort());
    expect(markers.length).toBeGreaterThan(15);
  });

  // How to call each probed route, and the fixture rows it must return.
  const PROBES: Record<string, { url: () => string; controls: (data: unknown) => boolean }> = {
    'GET /api/sessions': {
      url: () => '/api/sessions',
      controls: (data) => (data as { id: string }[]).some((s) => s.id === fixture.sessionId),
    },
    'GET /api/appointments': {
      url: () => `/api/appointments?from=${today}&to=${today}`,
      controls: (data) => (data as { id: string }[]).some((a) => a.id === fixture.appointmentId),
    },
    'GET /api/alerts': {
      url: () => '/api/alerts',
      controls: (data) =>
        (data as { patientId: string; type: string }[]).some(
          (a) => a.patientId === fixture.patientId && a.type === 'FOLLOW_UP',
        ),
    },
    'GET /api/payments': {
      url: () => '/api/payments',
      controls: (data) => (data as { id: string }[]).some((p) => p.id === fixture.paymentId),
    },
    'GET /api/patients': {
      url: () => '/api/patients',
      controls: (data) => (data as { id: string }[]).some((p) => p.id === fixture.patientId),
    },
    // The complaint appears, and only at its allowed path (Decision 1).
    'GET /api/dashboard/stats': {
      url: () => '/api/dashboard/stats',
      controls: (data) =>
        (data as { pathologies: { name: string }[] }).pathologies.some((p) => p.name === fixture.complaint),
    },
  };

  const probedKeys = Object.entries(LIST_SCOPE)
    .filter(([, entry]) => entry.scope === 'probed')
    .map(([key]) => key);

  it('every probed route has a probe', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...probedKeys].sort());
  });

  it.each(probedKeys)('%s returns the fixture, no marker, and exactly its keys', async (key) => {
    const entry = LIST_SCOPE[key];
    if (entry.scope !== 'probed') throw new Error('not probed');
    const probe = PROBES[key];

    const res = await auth(request(app).get(probe.url()));

    expect(res.status).toBe(200);
    const data: unknown = res.body.data;
    expect(probe.controls(data), 'the fixture\'s own rows are not in the response').toBe(true);

    const body = JSON.stringify(withoutAllowed(data, entry.allow));
    expect(markers.filter((m) => body.includes(m)), 'clinical markers in the response').toEqual([]);

    const seen = new Set<string>();
    const items = Array.isArray(data) ? data : [data];
    const errors = items.flatMap((item) => shapeErrors(item, entry.shape, '$', seen));
    expect(errors).toEqual([]);
    const unseen = objectPaths(entry.shape, '$').filter((p) => !seen.has(p));
    expect(unseen, 'nested objects the fixture never filled').toEqual([]);
  });
});
