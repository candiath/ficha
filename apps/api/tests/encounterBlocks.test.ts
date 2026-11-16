import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// A visit can treat several problems, the back and an ankle sprain say (#238).
// The encounter holds the visit itself; each episode it treated gets a block with
// everything clinical about that problem (how it arrived, the treatment, the
// pain, the re-evaluation, the exercises), so each episode's history and pain
// chart show only its own.
describe('An encounter treats several episodes, each with its own block', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let otherPatient: { id: string };
  let back: string;
  let ankle: string;
  let otherPatientsEpisode: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const encountersUrl = () => `/api/patients/${patient.id}/encounters`;

  const createEpisode = async (patientId: string, mainComplaint: string) =>
    (
      await fixture.clinicalEpisode.create({
        data: { tenantId: clinic.tenantId, patientId, mainComplaint },
        select: { id: true },
      })
    ).id;

  const post = (body: Record<string, unknown>) =>
    auth(request(app).post(encountersUrl())).send({ encounterDate: new Date().toISOString(), ...body });

  const patch = (id: string, body: Record<string, unknown>) =>
    auth(request(app).patch(`${encountersUrl()}/${id}`)).send({ reason: 'DATA_ENTRY_ERROR', ...body });

  const get = async (id: string) => (await auth(request(app).get(`${encountersUrl()}/${id}`))).body.data;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Dos', lastName: 'problemas' },
      select: { id: true },
    });
    otherPatient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Otro', lastName: 'paciente' },
      select: { id: true },
    });
    back = await createEpisode(patient.id, 'Lumbalgia');
    ankle = await createEpisode(patient.id, 'Esguince de tobillo');
    otherPatientsEpisode = await createEpisode(otherPatient.id, 'Cervicalgia');
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.encounterBlock.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.encounter.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  it('records one visit with a block per episode', async () => {
    const res = await post({
      episodes: [
        { episodeId: back, treatment: 'Rana en el suelo', painScaleBefore: 5, painScaleAfter: 2 },
        { episodeId: ankle, preEncounterState: 'Llega rengueando', painScaleBefore: 6, reEvaluationNotes: 'Edema leve' },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.observations).toBeNull();
    // Ordered by episode: the episodes' ids are UUIDv7, so the back comes first.
    expect(res.body.data.episodes).toEqual([
      {
        episodeId: back,
        preEncounterState: null,
        treatment: 'Rana en el suelo',
        painScaleBefore: 5,
        painScaleAfter: 2,
        patientExercises: null,
        reEvaluationNotes: null,
      },
      {
        episodeId: ankle,
        preEncounterState: 'Llega rengueando',
        treatment: null,
        painScaleBefore: 6,
        painScaleAfter: null,
        patientExercises: null,
        reEvaluationNotes: 'Edema leve',
      },
    ]);
  });

  it('lists the shared encounter in the history of each episode it treated', async () => {
    const shared = (await post({ episodes: [{ episodeId: back }, { episodeId: ankle }] })).body.data.id;
    const backOnly = (await post({ episodes: [{ episodeId: back }] })).body.data.id;

    const idsOf = async (episodeId: string) =>
      (await auth(request(app).get(`${encountersUrl()}?episodeId=${episodeId}`))).body.data.map(
        (s: { id: string }) => s.id,
      );

    expect(await idsOf(back)).toEqual(expect.arrayContaining([shared, backOnly]));
    expect(await idsOf(ankle)).toContain(shared);
    expect(await idsOf(ankle)).not.toContain(backOnly);
  });

  it('updates one field of one block and leaves everything else as it was', async () => {
    const id = (
      await post({
        observations: 'Sin cambios',
        episodes: [
          { episodeId: back, painScaleBefore: 7, patientExercises: 'Pared' },
          { episodeId: ankle, painScaleBefore: 4 },
        ],
      })
    ).body.data.id;

    const res = await patch(id, {
      episodes: [{ episodeId: back, painScaleAfter: 3 }, { episodeId: ankle }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.observations).toBe('Sin cambios');
    expect(res.body.data.episodes).toMatchObject([
      { episodeId: back, painScaleBefore: 7, painScaleAfter: 3, patientExercises: 'Pared', reEvaluationNotes: null },
      { episodeId: ankle, painScaleBefore: 4, painScaleAfter: null, patientExercises: null, reEvaluationNotes: null },
    ]);
  });

  it('removes the block of an episode left out and adds one for a new episode', async () => {
    const id = (await post({ episodes: [{ episodeId: back, painScaleBefore: 7 }] })).body.data.id;

    const res = await patch(id, { episodes: [{ episodeId: ankle, painScaleBefore: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.episodes).toEqual([
      {
        episodeId: ankle,
        preEncounterState: null,
        treatment: null,
        painScaleBefore: 2,
        painScaleAfter: null,
        patientExercises: null,
        reEvaluationNotes: null,
      },
    ]);
    expect(await prisma.encounterBlock.count({ where: { encounterId: id } })).toBe(1);
  });

  it('an encounter needs an episode; a note does not', async () => {
    const encounter = await post({ encounterType: 'SESSION', episodes: [] });
    expect(encounter.status).toBe(400);
    expect(encounter.body).toEqual({ error: 'Una sesión aborda al menos un episodio' });

    const note = await post({ encounterType: 'NOTE', observations: 'Llamó para reprogramar' });
    expect(note.status).toBe(201);
    expect(note.body.data.episodes).toEqual([]);
  });

  it('a discharge closes exactly one episode', async () => {
    const before = await prisma.encounter.count({ where: { patientId: patient.id } });

    const both = await post({ encounterType: 'DISCHARGE', episodes: [{ episodeId: back }, { episodeId: ankle }] });
    expect(both.status).toBe(400);
    expect(both.body).toEqual({ error: 'Un alta cierra exactamente un episodio' });

    const none = await post({ encounterType: 'DISCHARGE', episodes: [] });
    expect(none.status).toBe(400);

    // Nothing was recorded, and no episode was closed.
    expect(await prisma.encounter.count({ where: { patientId: patient.id } })).toBe(before);
    const statuses = await prisma.clinicalEpisode.findMany({
      where: { id: { in: [back, ankle] } },
      select: { status: true },
    });
    expect(statuses.map((e) => e.status)).toEqual(['ACTIVE', 'ACTIVE']);
  });

  it('refuses an edit that would leave an encounter without episodes, and changes nothing', async () => {
    const id = (await post({ episodes: [{ episodeId: back, painScaleBefore: 6 }] })).body.data.id;

    const res = await patch(id, { observations: 'No se guarda', episodes: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Una sesión aborda al menos un episodio' });
    const after = await get(id);
    expect(after.observations).toBeNull();
    expect(after.episodes).toHaveLength(1);
  });

  it('refuses the same episode twice', async () => {
    const res = await post({ episodes: [{ episodeId: back }, { episodeId: back }] });
    expect(res.status).toBe(400);
  });

  // The pain used to be a field of the encounter. A client still sending it
  // there gets a 400 instead of losing it in silence.
  it('refuses a block field sent at the encounter level', async () => {
    const res = await post({ episodes: [{ episodeId: back }], painScaleBefore: 5 });
    expect(res.status).toBe(400);
  });

  it('refuses an episode of another patient, in the API and in the database', async () => {
    const res = await post({ episodes: [{ episodeId: otherPatientsEpisode }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Episodio inexistente o de otro paciente' });

    // The block's keys name the encounter's clinic and patient: a write that
    // skips the API still cannot join one patient's encounter to another's episode.
    const note = await post({ encounterType: 'NOTE' });
    await expect(
      prisma.encounterBlock.create({
        data: {
          tenantId: clinic.tenantId,
          patientId: patient.id,
          encounterId: note.body.data.id,
          episodeId: otherPatientsEpisode,
        },
      }),
    ).rejects.toThrow();
  });

  it('audits a change in one block as its field, and a new empty block as the episodes', async () => {
    const id = (await post({ episodes: [{ episodeId: back, painScaleBefore: 7 }] })).body.data.id;

    expect((await patch(id, { episodes: [{ episodeId: back, painScaleBefore: 5 }] })).status).toBe(200);
    expect(
      (await patch(id, { episodes: [{ episodeId: back }, { episodeId: ankle }] })).status,
    ).toBe(200);
    expect(
      (await patch(id, { episodes: [{ episodeId: back }, { episodeId: ankle, treatment: 'Drenaje' }] })).status,
    ).toBe(200);

    const rows = await prisma.auditLog.findMany({
      where: { tenantId: clinic.tenantId, entityId: id, action: 'ENCOUNTER_UPDATED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { params: true },
    });
    expect(rows.map((r) => r.params)).toEqual([
      { encounterType: 'SESSION', changedFields: ['painScaleBefore'], reason: 'DATA_ENTRY_ERROR' },
      { encounterType: 'SESSION', changedFields: ['episodeIds'], reason: 'DATA_ENTRY_ERROR' },
      { encounterType: 'SESSION', changedFields: ['treatment'], reason: 'DATA_ENTRY_ERROR' },
    ]);
  });
});
