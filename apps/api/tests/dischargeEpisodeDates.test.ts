import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// A discharge closes its episode on the discharge's own date, and the episode
// follows it while the closing is the discharge's: a corrected date moves the
// closing, an annulment reopens the episode (#278). A discharge of an episode
// that is not active is refused (#279), and the database refuses a closing
// before the opening (#280).
describe('a discharge and its episode', () => {
  let clinic: TestClinic;
  let token: string;
  let patient: { id: string };

  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const encountersUrl = () => `/api/patients/${patient.id}/encounters`;

  async function openEpisode(openedAt = daysAgo(30)) {
    return fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Lumbalgia', openedAt },
      select: { id: true },
    });
  }

  function postEncounter(body: Record<string, unknown>) {
    return auth(request(app).post(encountersUrl())).send(body);
  }

  function discharge(episodeId: string, encounterDate: Date) {
    return postEncounter({
      encounterType: 'DISCHARGE',
      encounterDate: encounterDate.toISOString(),
      episodes: [{ episodeId }],
    });
  }

  function patchEncounter(id: string, body: Record<string, unknown>) {
    return auth(request(app).patch(`${encountersUrl()}/${id}`)).send({ reason: 'DATA_ENTRY_ERROR', ...body });
  }

  function annul(id: string) {
    return auth(request(app).post(`${encountersUrl()}/${id}/annul`)).send({ reason: 'DATA_ENTRY_ERROR' });
  }

  function episodeState(id: string) {
    return prisma.clinicalEpisode.findUniqueOrThrow({ where: { id }, select: { status: true, closedAt: true } });
  }

  function episodeVersions(id: string) {
    return prisma.episodeRevision.count({ where: { episodeId: id } });
  }

  // The episode's latest version, with the audit row that owns it: a row of
  // the episode's own, in the encounter's transaction.
  async function latestEpisodeRow(episodeId: string) {
    const revision = await prisma.episodeRevision.findFirstOrThrow({
      where: { episodeId },
      orderBy: { version: 'desc' },
      select: { auditLog: { select: { entity: true, entityId: true, action: true, params: true, transactionId: true } } },
    });
    return revision.auditLog;
  }

  async function encounterRow(encounterId: string, action: 'ENCOUNTER_UPDATED' | 'ENCOUNTER_ANNULLED') {
    return prisma.auditLog.findFirstOrThrow({ where: { entityId: encounterId, action }, select: { transactionId: true } });
  }

  beforeAll(async () => {
    clinic = await createTestClinic();
    const user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente', lastName: 'Alta' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinic.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.encounterBlock.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.encounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
  });

  describe('recording it (#278)', () => {
    it('closes the episode on the discharge date, not when it is entered', async () => {
      const episode = await openEpisode();
      const date = daysAgo(3);

      const res = await discharge(episode.id, date);

      expect(res.status).toBe(201);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: date });
    });

    it('refuses a discharge dated before the episode opened, and records nothing', async () => {
      const episode = await openEpisode(daysAgo(5));
      const before = await prisma.encounter.count({ where: { patientId: patient.id } });

      const res = await discharge(episode.id, daysAgo(6));

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: 'La fecha del alta no puede ser anterior a la apertura del episodio',
        code: 'discharge_before_opening',
      });
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'ACTIVE', closedAt: null });
      await expect(prisma.encounter.count({ where: { patientId: patient.id } })).resolves.toBe(before);
    });
  });

  describe('an episode that is not active (#279)', () => {
    it.each(['DISCHARGED', 'ABANDONED'] as const)('refuses a discharge of a %s episode, and changes nothing', async (status) => {
      const episode = await openEpisode();
      const closedAt = daysAgo(10);
      const closed = await auth(request(app).patch(`/api/patients/${patient.id}/episodes/${episode.id}`)).send({
        status,
        closedAt: closedAt.toISOString(),
      });
      expect(closed.status).toBe(200);
      const versions = await episodeVersions(episode.id);
      const before = await prisma.encounter.count({ where: { patientId: patient.id } });

      const res = await discharge(episode.id, daysAgo(2));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'El episodio ya está cerrado', code: 'episode_not_active' });
      await expect(episodeState(episode.id)).resolves.toEqual({ status, closedAt });
      await expect(episodeVersions(episode.id)).resolves.toBe(versions);
      await expect(prisma.encounter.count({ where: { patientId: patient.id } })).resolves.toBe(before);
    });
  });

  describe('correcting it', () => {
    it("moves the episode's closing with the discharge date, in a new episode version", async () => {
      const episode = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));
      const versions = await episodeVersions(episode.id);
      const corrected = daysAgo(4);

      const res = await patchEncounter(created.body.data.id, {
        encounterDate: corrected.toISOString(),
        expectedVersion: created.body.data.version,
      });

      expect(res.status).toBe(200);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: corrected });
      await expect(episodeVersions(episode.id)).resolves.toBe(versions + 1);
      const row = await latestEpisodeRow(episode.id);
      expect(row).toMatchObject({
        entity: 'EPISODE',
        entityId: episode.id,
        action: 'EPISODE_UPDATED',
        params: { changedFields: ['closedAt'], reason: 'DATA_ENTRY_ERROR' },
      });
      expect(row.transactionId).toBe((await encounterRow(created.body.data.id, 'ENCOUNTER_UPDATED')).transactionId);
    });

    it('refuses a corrected date before the opening, and changes nothing', async () => {
      const episode = await openEpisode(daysAgo(5));
      const date = daysAgo(3);
      const created = await discharge(episode.id, date);

      const res = await patchEncounter(created.body.data.id, { encounterDate: daysAgo(6).toISOString() });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('discharge_before_opening');
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: date });
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: created.body.data.id } });
      expect(encounter.encounterDate).toEqual(date);
    });

    it('editing only its text leaves the episode alone', async () => {
      const episode = await openEpisode();
      const date = daysAgo(3);
      const created = await discharge(episode.id, date);
      const versions = await episodeVersions(episode.id);

      const res = await patchEncounter(created.body.data.id, { observations: 'Alta con indicaciones' });

      expect(res.status).toBe(200);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: date });
      await expect(episodeVersions(episode.id)).resolves.toBe(versions);
    });

    it('does not move a closing the discharge no longer owns: the episode was reopened', async () => {
      const episode = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));
      const reopened = await auth(request(app).patch(`/api/patients/${patient.id}/episodes/${episode.id}`)).send({
        status: 'ACTIVE',
      });
      expect(reopened.status).toBe(200);

      const res = await patchEncounter(created.body.data.id, { encounterDate: daysAgo(4).toISOString() });

      expect(res.status).toBe(200);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'ACTIVE', closedAt: null });
    });

    it.each([
      ['a discharge into a session', 'DISCHARGE', 'SESSION'],
      ['a discharge into a note', 'DISCHARGE', 'NOTE'],
      ['a session into a discharge', 'SESSION', 'DISCHARGE'],
      ['a note into a discharge', 'NOTE', 'DISCHARGE'],
    ] as const)('refuses turning %s', async (_label, from, to) => {
      const episode = await openEpisode();
      const created = await postEncounter({
        encounterType: from,
        encounterDate: daysAgo(3).toISOString(),
        episodes: [{ episodeId: episode.id }],
      });
      expect(created.status).toBe(201);
      const state = await episodeState(episode.id);

      const res = await patchEncounter(created.body.data.id, { encounterType: to });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('discharge_type_fixed');
      await expect(episodeState(episode.id)).resolves.toEqual(state);
    });

    it('refuses moving a discharge to another episode', async () => {
      const episode = await openEpisode();
      const other = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));

      const res = await patchEncounter(created.body.data.id, { episodes: [{ episodeId: other.id }] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('discharge_episode_fixed');
      await expect(episodeState(other.id)).resolves.toEqual({ status: 'ACTIVE', closedAt: null });
    });

    it("lets a discharge's block be edited on the same episode", async () => {
      const episode = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));

      const res = await patchEncounter(created.body.data.id, { episodes: [{ episodeId: episode.id, painScaleAfter: 1 }] });

      expect(res.status).toBe(200);
      expect(res.body.data.episodes[0].painScaleAfter).toBe(1);
    });
  });

  describe('annulling it', () => {
    it('reopens the episode it closed, in a new episode version', async () => {
      const episode = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));
      const versions = await episodeVersions(episode.id);

      const res = await annul(created.body.data.id);

      expect(res.status).toBe(204);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'ACTIVE', closedAt: null });
      await expect(episodeVersions(episode.id)).resolves.toBe(versions + 1);
      const row = await latestEpisodeRow(episode.id);
      expect(row).toMatchObject({ entity: 'EPISODE', entityId: episode.id, action: 'EPISODE_REOPENED', params: {} });
      expect(row.transactionId).toBe((await encounterRow(created.body.data.id, 'ENCOUNTER_ANNULLED')).transactionId);
    });

    it('leaves the episode alone when a later discharge closed it', async () => {
      const episode = await openEpisode();
      const first = await discharge(episode.id, daysAgo(10));
      await auth(request(app).patch(`/api/patients/${patient.id}/episodes/${episode.id}`)).send({ status: 'ACTIVE' });
      const secondDate = daysAgo(2);
      const second = await discharge(episode.id, secondDate);
      expect(second.status).toBe(201);

      const res = await annul(first.body.data.id);

      expect(res.status).toBe(204);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: secondDate });
    });

    it('leaves the episode alone when its closing was corrected by hand', async () => {
      const episode = await openEpisode();
      const created = await discharge(episode.id, daysAgo(3));
      const byHand = daysAgo(4);
      const edited = await auth(request(app).patch(`/api/patients/${patient.id}/episodes/${episode.id}`)).send({
        status: 'DISCHARGED',
        closedAt: byHand.toISOString(),
        reason: 'DATA_ENTRY_ERROR',
      });
      expect(edited.status).toBe(200);

      const res = await annul(created.body.data.id);

      expect(res.status).toBe(204);
      await expect(episodeState(episode.id)).resolves.toEqual({ status: 'DISCHARGED', closedAt: byHand });
    });
  });

  describe('the database (#280)', () => {
    it('refuses a closing before the opening', async () => {
      const episode = await openEpisode(daysAgo(5));

      await expect(
        prisma.clinicalEpisode.update({
          where: { id: episode.id },
          data: { status: 'ABANDONED', closedAt: daysAgo(6) },
        }),
      ).rejects.toThrow(/clinical_episodes_closed_after_opened/);
    });
  });
});
