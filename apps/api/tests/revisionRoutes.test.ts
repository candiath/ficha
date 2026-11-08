import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// Reading the history of a clinical record (SPEC-clinical-revisions.md §7):
// two routes per versioned aggregate, inside the patient's record.
describe('revision routes', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let token: string;
  let otherToken: string;
  let userId: string;

  // Patient A has one of each aggregate, written through the API so each has an
  // author; patient B has a session of her own.
  let patientA: string;
  let patientB: string;
  let episodeId: string;
  let sessionId: string;
  let eventId: string;
  let sessionOfB: string;

  const REASON = { reason: 'LATE_INFORMATION' };
  const auth = (r: request.Test, t = token) => r.set('Authorization', `Bearer ${t}`);
  const get = (path: string, t = token) => auth(request(app).get(path), t);

  const expectStatus = async (res: request.Test | Promise<request.Response>, status: number) => {
    const r = await res;
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    return r;
  };

  // Every aggregate's history base, for patient A.
  const bases = () => ({
    patient: `/api/patients/${patientA}/revisions`,
    session: `/api/patients/${patientA}/sessions/${sessionId}/revisions`,
    episode: `/api/patients/${patientA}/episodes/${episodeId}/revisions`,
    evaluation: `/api/patients/${patientA}/episodes/${episodeId}/evaluation/revisions`,
    consent: `/api/patients/${patientA}/consent/revisions`,
    patientEvent: `/api/patients/${patientA}/events/${eventId}/revisions`,
  });

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
    const user = await clinic.createUser({ name: 'Laura Revisora' });
    userId = user.id;
    token = await createTestToken(user);
    otherToken = await createTestToken(await other.createUser());

    const created = async (path: string, body: object) =>
      (await expectStatus(auth(request(app).post(path)).send(body), 201)).body.data;

    // Patient: created, then corrected with a note.
    patientA = (await created('/api/patients', { firstName: 'Ana', lastName: 'Historia' })).id;
    await expectStatus(
      auth(request(app).patch(`/api/patients/${patientA}`)).send({ ...REASON, occupation: 'Docente', reasonNote: 'Lo dijo hoy' }),
      200,
    );
    patientB = (await created('/api/patients', { firstName: 'Berta', lastName: 'Otra' })).id;

    // Episode, evaluation, session (with its episode block), consent, event.
    episodeId = (await created(`/api/patients/${patientA}/episodes`, { mainComplaint: 'Lumbalgia' })).id;
    await expectStatus(
      auth(request(app).put(`/api/patients/${patientA}/episodes/${episodeId}/evaluation`)).send({
        expectedVersion: 0,
        notes: 'Primera',
      }),
      200,
    );
    sessionId = (
      await created(`/api/patients/${patientA}/sessions`, {
        sessionDate: new Date().toISOString(),
        episodes: [{ episodeId, treatment: 'Inicial' }],
      })
    ).id;
    await expectStatus(
      auth(request(app).patch(`/api/patients/${patientA}/sessions/${sessionId}`)).send({
        ...REASON,
        expectedVersion: 1,
        episodes: [{ episodeId, treatment: 'Corregido' }],
        reasonNote: 'Faltaba el detalle',
      }),
      200,
    );
    await created(`/api/patients/${patientA}/consent`, { expectedVersion: 0 });
    eventId = (
      await created(`/api/patients/${patientA}/events`, {
        kind: 'SURGERY',
        description: 'Rodilla',
        occurred: { date: '2019-01-01', precision: 'YEAR', approximate: false },
      })
    ).id;

    const episodeB = (await created(`/api/patients/${patientB}/episodes`, { mainComplaint: 'Cervicalgia' })).id;
    sessionOfB = (
      await created(`/api/patients/${patientB}/sessions`, {
        sessionDate: new Date().toISOString(),
        episodes: [{ episodeId: episodeB, treatment: 'De B' }],
      })
    ).id;
  });

  afterAll(async () => {
    await sleep(200);
    for (const c of [clinic, other]) {
      const where = { tenantId: c.tenantId };
      await deleteAuditRows([c.tenantId]);
      await prisma.sessionEpisode.deleteMany({ where });
      await prisma.session.deleteMany({ where });
      await prisma.initialEvaluation.deleteMany({ where });
      await prisma.clinicalEpisode.deleteMany({ where });
      await prisma.informedConsent.deleteMany({ where });
      await prisma.patientEvent.deleteMany({ where });
      await prisma.patient.deleteMany({ where });
      await c.cleanup();
    }
  });

  describe('the list', () => {
    it('lists the versions newest first, with action, reason, author and time', async () => {
      const res = await expectStatus(get(bases().session), 200);
      expect(res.body.data).toEqual([
        {
          version: 2,
          action: 'SESSION_UPDATED',
          params: { sessionType: 'SESSION', changedFields: ['treatment'], reason: 'LATE_INFORMATION' },
          actorType: 'USER',
          author: { id: userId, name: 'Laura Revisora' },
          createdAt: expect.any(String),
        },
        expect.objectContaining({ version: 1, action: 'SESSION_RECORDED', author: { id: userId, name: 'Laura Revisora' } }),
      ]);
    });

    it('carries no content: no snapshot and no note', async () => {
      const res = await expectStatus(get(bases().session), 200);
      for (const item of res.body.data) {
        expect(item).not.toHaveProperty('snapshot');
        expect(item).not.toHaveProperty('reasonNote');
      }
    });

    it.each([
      ['patient', ['PATIENT_UPDATED', 'PATIENT_CREATED']],
      ['episode', ['EPISODE_OPENED']],
      ['evaluation', ['EVALUATION_CREATED']],
      ['consent', ['CONSENT_SIGNED']],
      ['patientEvent', ['PATIENT_EVENT_RECORDED']],
    ] as const)('lists the %s’s versions', async (aggregate, actions) => {
      const res = await expectStatus(get(bases()[aggregate]), 200);
      expect(res.body.data.map((r: { action: string }) => r.action)).toEqual(actions);
      expect(res.body.data.map((r: { version: number }) => r.version)).toEqual(actions.map((_, i) => actions.length - i));
    });

    it('names no author for a SYSTEM row', async () => {
      const { id } = await fixture.patient.create({ data: { tenantId: clinic.tenantId, firstName: 'De', lastName: 'Sistema' } });
      const res = await expectStatus(get(`/api/patients/${id}/revisions`), 200);
      expect(res.body.data).toEqual([expect.objectContaining({ version: 1, actorType: 'SYSTEM', author: null })]);
    });

    it('is empty for an aggregate with no revision (version 0)', async () => {
      const { id } = await prisma.patient.create({
        data: { tenantId: clinic.tenantId, firstName: 'Sin', lastName: 'Historia' },
        select: { id: true },
      });
      try {
        const res = await expectStatus(get(`/api/patients/${id}/revisions`), 200);
        expect(res.body.data).toEqual([]);
        await expectStatus(get(`/api/patients/${id}/revisions/1`), 404);
      } finally {
        // Unversioned on purpose: gone before the invariant looks.
        await prisma.patient.delete({ where: { id } });
      }
    });
  });

  describe('one version', () => {
    it('returns its snapshot and its note', async () => {
      const v1 = await expectStatus(get(`${bases().session}/1`), 200);
      expect(v1.body.data).toMatchObject({
        version: 1,
        action: 'SESSION_RECORDED',
        schemaVersion: 1,
        reasonNote: null,
        snapshot: { episodes: [expect.objectContaining({ episodeId, treatment: 'Inicial' })] },
      });

      const v2 = await expectStatus(get(`${bases().session}/2`), 200);
      expect(v2.body.data).toMatchObject({
        version: 2,
        params: expect.objectContaining({ reason: 'LATE_INFORMATION' }),
        author: { id: userId, name: 'Laura Revisora' },
        reasonNote: 'Faltaba el detalle',
        snapshot: { episodes: [expect.objectContaining({ treatment: 'Corregido' })] },
      });
    });

    it.each(['patient', 'episode', 'evaluation', 'consent', 'patientEvent'] as const)(
      'returns version 1 of the %s',
      async (aggregate) => {
        const res = await expectStatus(get(`${bases()[aggregate]}/1`), 200);
        expect(res.body.data).toMatchObject({ version: 1, schemaVersion: 1, snapshot: expect.any(Object) });
      },
    );

    it('returns the patient’s correction with its note', async () => {
      const res = await expectStatus(get(`${bases().patient}/2`), 200);
      expect(res.body.data).toMatchObject({ reasonNote: 'Lo dijo hoy', snapshot: { occupation: 'Docente' } });
    });

    it('answers 404 to a version that does not exist', async () => {
      const res = await expectStatus(get(`${bases().session}/3`), 404);
      expect(res.body).toEqual({ error: 'Versión no encontrada' });
    });

    it.each(['0', '-1', '1.5', 'abc', '01', '1e3', '9999999999'])('answers 404 to the version %s', async (version) => {
      const res = await expectStatus(get(`${bases().session}/${version}`), 404);
      expect(res.body).toEqual({ error: 'Versión no encontrada' });
    });
  });

  describe('only inside the record', () => {
    it('answers 404 to patient B’s session through patient A’s path', async () => {
      const path = `/api/patients/${patientA}/sessions/${sessionOfB}/revisions`;
      expect((await expectStatus(get(path), 404)).body).toEqual({ error: 'Sesión no encontrada' });
      await expectStatus(get(`${path}/1`), 404);
    });

    it('answers 404 to patient A’s episode through patient B’s path, for the episode and its evaluation', async () => {
      await expectStatus(get(`/api/patients/${patientB}/episodes/${episodeId}/revisions`), 404);
      await expectStatus(get(`/api/patients/${patientB}/episodes/${episodeId}/evaluation/revisions/1`), 404);
      await expectStatus(get(`/api/patients/${patientB}/events/${eventId}/revisions`), 404);
    });

    it('answers 404 to a patient without a consent', async () => {
      await expectStatus(get(`/api/patients/${patientB}/consent/revisions`), 404);
    });

    it.each(['patient', 'session', 'episode', 'evaluation', 'consent', 'patientEvent'] as const)(
      'answers 404 to another clinic, for the %s',
      async (aggregate) => {
        await expectStatus(get(bases()[aggregate], otherToken), 404);
        await expectStatus(get(`${bases()[aggregate]}/1`, otherToken), 404);
      },
    );

    // With the entity's message, not the errorHandler's "No encontrado": that
    // one is the P2023 safety net, which an unvalidated id would reach.
    it.each([
      ['/api/patients/no-es-un-id/revisions', 'Paciente no encontrado'],
      ['/api/patients/no-es-un-id/revisions/1', 'Paciente no encontrado'],
      ['/api/patients/no-es-un-id/sessions/{session}/revisions', 'Paciente no encontrado'],
      ['/api/patients/{patient}/sessions/no-es-un-id/revisions/1', 'Sesión no encontrada'],
      ['/api/patients/{patient}/episodes/no-es-un-id/revisions', 'Episodio no encontrado'],
      ['/api/patients/{patient}/episodes/no-es-un-id/evaluation/revisions', 'Episodio no encontrado'],
      ['/api/patients/{patient}/events/no-es-un-id/revisions', 'Antecedente no encontrado'],
    ])('answers 404 to a malformed id: %s', async (template, error) => {
      const path = template.replace('{patient}', patientA).replace('{session}', sessionId);
      expect((await expectStatus(get(path), 404)).body).toEqual({ error });
    });

    it('asks for a login', async () => {
      expect((await request(app).get(bases().session)).status).toBe(401);
    });
  });

  describe('a deleted patient', () => {
    it('answers 404 for every aggregate', async () => {
      const urls = bases();
      await expectStatus(auth(request(app).delete(`/api/patients/${patientA}`)), 204);
      for (const path of Object.values(urls)) {
        await expectStatus(get(path), 404);
        await expectStatus(get(`${path}/1`), 404);
      }
    });
  });
});
