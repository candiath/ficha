import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { episodeRepo } from '../src/repositories';
import { createTestClinic, createTestContext, createTestToken, deleteAuditRows, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// Annulment (SPEC-clinical-revisions.md §8): an encounter or a patient antecedent
// entered by mistake is annulled with a reason, never deleted. It stays in the
// patient's record, marked, with its content in its history, and leaves every
// other reader. tests/encounterAnnul.test.ts covers what an encounter's annulment
// does to its payment and its appointment.
describe('annulment', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patientId: string;
  let episodeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const encountersUrl = () => `/api/patients/${patientId}/encounters`;
  const antecedentsUrl = () => `/api/patients/${patientId}/antecedents`;
  const annulEncounter = (id: string, body: object) => auth(request(app).post(`${encountersUrl()}/${id}/annul`)).send(body);
  const annulAntecedent = (id: string, body: object) => auth(request(app).post(`${antecedentsUrl()}/${id}/annul`)).send(body);

  const newEncounter = async (body: object = {}): Promise<string> => {
    const res = await auth(request(app).post(encountersUrl())).send({
      encounterDate: new Date().toISOString(),
      episodes: [{ episodeId, treatment: 'Cadena posterior', painScaleBefore: 6 }],
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const newAntecedent = async (): Promise<string> => {
    const res = await auth(request(app).post(antecedentsUrl())).send({ kind: 'FRACTURE', description: 'Fractura de muñeca', occurred: null });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const auditRows = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    ({ id: patientId } = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Con', lastName: 'Anulaciones' },
      select: { id: true },
    }));
    ({ id: episodeId } = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId, mainComplaint: 'Lumbalgia' },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where });
    await prisma.encounterBlock.deleteMany({ where });
    await prisma.encounter.deleteMany({ where });
    await prisma.patientAntecedent.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  describe('an encounter', () => {
    it('records the action with its reason, and a final version with the note', async () => {
      const id = await newEncounter();

      const res = await annulEncounter(id, { reason: 'LATE_INFORMATION', reasonNote: 'La paciente no vino ese día' });
      expect(res.status).toBe(204);

      const rows = await auditRows(id);
      expect(rows.map((r) => r.action)).toEqual(['ENCOUNTER_RECORDED', 'ENCOUNTER_ANNULLED']);
      expect(rows[1]).toMatchObject({ userId: user.id, params: { encounterType: 'SESSION', reason: 'LATE_INFORMATION' } });
      const [first, last] = await prisma.encounterRevision.findMany({ where: { encounterId: id }, orderBy: { version: 'asc' } });
      expect(last).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: 'La paciente no vino ese día' });
      // The content does not change: the annulment is what the audit row says.
      expect(last.snapshot).toEqual(first.snapshot);
    });

    it('answers 400 without a reason, or with one the catalog does not know, and writes nothing', async () => {
      const id = await newEncounter();

      for (const body of [{}, { reasonNote: 'Sin motivo' }, { reason: 'WRONG_PATIENT' }, { reason: 'OTHER', extra: 1 }]) {
        expect((await annulEncounter(id, body)).status).toBe(400);
      }

      expect((await prisma.encounter.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await prisma.encounterRevision.count({ where: { encounterId: id } })).toBe(1);
      expect((await auditRows(id)).map((r) => r.action)).toEqual(['ENCOUNTER_RECORDED']);
    });

    it('answers 409 to a paid encounter and writes nothing', async () => {
      const id = await newEncounter({ payment: { baseAmountCents: 1000 } });
      await prisma.payment.updateMany({ where: { encounterId: id }, data: { status: 'PAID', paidAt: new Date(), method: 'CASH' } });

      expect((await annulEncounter(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(409);

      expect((await prisma.encounter.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await prisma.encounterRevision.count({ where: { encounterId: id } })).toBe(1);
      expect(await auditRows(id)).toHaveLength(1);
      await prisma.payment.deleteMany({ where: { encounterId: id } });
    });

    it('stays in the record marked, and leaves every other reader', async () => {
      // An episode of its own, so its last activity is one of these two.
      const { id: ownEpisode } = await fixture.clinicalEpisode.create({
        data: { tenantId: clinic.tenantId, patientId, mainComplaint: 'Cervicalgia' },
        select: { id: true },
      });
      const block = { episodes: [{ episodeId: ownEpisode }] };
      const kept = await newEncounter({ ...block, encounterDate: new Date(Date.now() - 86_400_000).toISOString() });
      const id = await newEncounter(block);
      expect((await annulEncounter(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(204);

      // The record's list, with and without the episode's filter.
      for (const url of [encountersUrl(), `${encountersUrl()}?episodeId=${ownEpisode}`]) {
        const list = (await auth(request(app).get(url))).body.data as { id: string; annulledAt: string | null }[];
        expect(list.find((s) => s.id === id)?.annulledAt).toEqual(expect.any(String));
        expect(list.find((s) => s.id === kept)?.annulledAt).toBeNull();
      }

      // Read alone, edited or annulled again: gone.
      expect((await auth(request(app).get(`${encountersUrl()}/${id}`))).status).toBe(404);
      const edit = await auth(request(app).patch(`${encountersUrl()}/${id}`)).send({ reason: 'OTHER', observations: 'Tarde' });
      expect(edit.status).toBe(404);
      expect((await annulEncounter(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);

      // The clinic's index.
      const index = (await auth(request(app).get('/api/encounters'))).body.data as { id: string }[];
      expect(index.map((s) => s.id)).toContain(kept);
      expect(index.map((s) => s.id)).not.toContain(id);

      // The episode's last activity (the inactivity alert's reader) is the
      // encounter that was kept: a cutoff ahead of now lists every open episode.
      const ctx = await createTestContext(clinic.tenantId, user);
      const stale = await episodeRepo.listStale(ctx, new Date(Date.now() + 86_400_000));
      const keptDate = (await prisma.encounter.findUniqueOrThrow({ where: { id: kept } })).encounterDate.toISOString();
      expect(stale.find((e) => e.episodeId === ownEpisode)?.lastActivityAt).toBe(keptDate);
    });

    it('keeps its history readable, with the annulment as its last version', async () => {
      const id = await newEncounter();
      expect((await annulEncounter(id, { reason: 'CLARIFICATION' })).status).toBe(204);

      const res = await auth(request(app).get(`${encountersUrl()}/${id}/revisions`));
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { version: number; action: string }) => [r.version, r.action])).toEqual(
        expect.arrayContaining([
          [1, 'ENCOUNTER_RECORDED'],
          [2, 'ENCOUNTER_ANNULLED'],
        ]),
      );
    });

    it("answers 404 to another patient's encounter and to an unknown id", async () => {
      const { id: other } = await fixture.patient.create({
        data: { tenantId: clinic.tenantId, firstName: 'Otra', lastName: 'Paciente' },
        select: { id: true },
      });
      const { id: otherEpisode } = await fixture.clinicalEpisode.create({
        data: { tenantId: clinic.tenantId, patientId: other },
        select: { id: true },
      });
      const created = await auth(request(app).post(`/api/patients/${other}/encounters`)).send({
        encounterDate: new Date().toISOString(),
        episodes: [{ episodeId: otherEpisode }],
      });

      expect((await annulEncounter(created.body.data.id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);
      expect((await annulEncounter(randomUUID(), { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);
      expect((await prisma.encounter.findUniqueOrThrow({ where: { id: created.body.data.id } })).deletedAt).toBeNull();
    });

    it('cannot be deleted any more', async () => {
      const id = await newEncounter();
      expect((await auth(request(app).delete(`${encountersUrl()}/${id}`))).status).toBe(404);
      expect((await prisma.encounter.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });
  });

  describe('a patient antecedent', () => {
    it('records the action with its reason, and a final version with the note', async () => {
      const id = await newAntecedent();

      const res = await annulAntecedent(id, { reason: 'DATA_ENTRY_ERROR', reasonNote: '   ' });
      expect(res.status).toBe(204);

      const rows = await auditRows(id);
      expect(rows.map((r) => r.action)).toEqual(['PATIENT_ANTECEDENT_RECORDED', 'PATIENT_ANTECEDENT_ANNULLED']);
      expect(rows[1].params).toEqual({ kind: 'FRACTURE', reason: 'DATA_ENTRY_ERROR' });
      const [first, last] = await prisma.patientAntecedentRevision.findMany({ where: { patientAntecedentId: id }, orderBy: { version: 'asc' } });
      // A blank note is no note (single empty).
      expect(last).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: null });
      expect(last.snapshot).toEqual(first.snapshot);
    });

    it('answers 400 without a reason and writes nothing', async () => {
      const id = await newAntecedent();

      expect((await annulAntecedent(id, {})).status).toBe(400);

      expect((await prisma.patientAntecedent.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await auditRows(id)).toHaveLength(1);
    });

    it('stays in the record marked, cannot be edited, and keeps its history', async () => {
      const id = await newAntecedent();
      expect((await annulAntecedent(id, { reason: 'OTHER' })).status).toBe(204);

      const list = (await auth(request(app).get(antecedentsUrl()))).body.data as { id: string; annulledAt: string | null }[];
      expect(list.find((e) => e.id === id)?.annulledAt).toEqual(expect.any(String));

      const edit = await auth(request(app).patch(`${antecedentsUrl()}/${id}`)).send({ reason: 'OTHER', description: 'Tarde' });
      expect(edit.status).toBe(404);
      expect((await annulAntecedent(id, { reason: 'OTHER' })).status).toBe(404);

      const history = await auth(request(app).get(`${antecedentsUrl()}/${id}/revisions`));
      expect(history.body.data.map((r: { action: string }) => r.action)).toContain('PATIENT_ANTECEDENT_ANNULLED');
    });

    it('cannot be deleted any more', async () => {
      const id = await newAntecedent();
      expect((await auth(request(app).delete(`${antecedentsUrl()}/${id}`))).status).toBe(404);
      expect((await prisma.patientAntecedent.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });
  });
});
