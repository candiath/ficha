import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// Annulment (SPEC-clinical-revisions.md §8): a session or a patient event
// entered by mistake is annulled with a reason, never deleted. It stays in the
// patient's record, marked, with its content in its history, and leaves every
// other reader. tests/sessionAnnul.test.ts covers what a session's annulment
// does to its payment and its appointment.
describe('annulment', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patientId: string;
  let episodeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const sessionsUrl = () => `/api/patients/${patientId}/sessions`;
  const eventsUrl = () => `/api/patients/${patientId}/events`;
  const annulSession = (id: string, body: object) => auth(request(app).post(`${sessionsUrl()}/${id}/annul`)).send(body);
  const annulEvent = (id: string, body: object) => auth(request(app).post(`${eventsUrl()}/${id}/annul`)).send(body);

  const newSession = async (body: object = {}): Promise<string> => {
    const res = await auth(request(app).post(sessionsUrl())).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId, treatment: 'Cadena posterior', painScaleBefore: 6 }],
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  const newEvent = async (): Promise<string> => {
    const res = await auth(request(app).post(eventsUrl())).send({ kind: 'FRACTURE', description: 'Fractura de muñeca', occurred: null });
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
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.patientEvent.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  describe('a session', () => {
    it('records the action with its reason, and a final version with the note', async () => {
      const id = await newSession();

      const res = await annulSession(id, { reason: 'LATE_INFORMATION', reasonNote: 'La paciente no vino ese día' });
      expect(res.status).toBe(204);

      const rows = await auditRows(id);
      expect(rows.map((r) => r.action)).toEqual(['SESSION_RECORDED', 'SESSION_ANNULLED']);
      expect(rows[1]).toMatchObject({ userId: user.id, params: { sessionType: 'SESSION', reason: 'LATE_INFORMATION' } });
      const [first, last] = await prisma.sessionRevision.findMany({ where: { sessionId: id }, orderBy: { version: 'asc' } });
      expect(last).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: 'La paciente no vino ese día' });
      // The content does not change: the annulment is what the audit row says.
      expect(last.snapshot).toEqual(first.snapshot);
    });

    it('answers 400 without a reason, or with one the catalog does not know, and writes nothing', async () => {
      const id = await newSession();

      for (const body of [{}, { reasonNote: 'Sin motivo' }, { reason: 'WRONG_PATIENT' }, { reason: 'OTHER', extra: 1 }]) {
        expect((await annulSession(id, body)).status).toBe(400);
      }

      expect((await prisma.session.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await prisma.sessionRevision.count({ where: { sessionId: id } })).toBe(1);
      expect((await auditRows(id)).map((r) => r.action)).toEqual(['SESSION_RECORDED']);
    });

    it('answers 409 to a paid session and writes nothing', async () => {
      const id = await newSession({ payment: { baseAmountCents: 1000 } });
      await prisma.payment.updateMany({ where: { sessionId: id }, data: { status: 'PAID', paidAt: new Date(), method: 'CASH' } });

      expect((await annulSession(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(409);

      expect((await prisma.session.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await prisma.sessionRevision.count({ where: { sessionId: id } })).toBe(1);
      expect(await auditRows(id)).toHaveLength(1);
      await prisma.payment.deleteMany({ where: { sessionId: id } });
    });

    it('stays in the record marked, and leaves every other reader', async () => {
      const kept = await newSession({ sessionDate: new Date(Date.now() - 86_400_000).toISOString() });
      const id = await newSession();
      expect((await annulSession(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(204);

      // The record's list, with and without the episode's filter.
      for (const url of [sessionsUrl(), `${sessionsUrl()}?episodeId=${episodeId}`]) {
        const list = (await auth(request(app).get(url))).body.data as { id: string; annulledAt: string | null }[];
        expect(list.find((s) => s.id === id)?.annulledAt).toEqual(expect.any(String));
        expect(list.find((s) => s.id === kept)?.annulledAt).toBeNull();
      }

      // Read alone, edited or annulled again: gone.
      expect((await auth(request(app).get(`${sessionsUrl()}/${id}`))).status).toBe(404);
      const edit = await auth(request(app).patch(`${sessionsUrl()}/${id}`)).send({ reason: 'OTHER', observations: 'Tarde' });
      expect(edit.status).toBe(404);
      expect((await annulSession(id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);

      // The clinic's index.
      const index = (await auth(request(app).get('/api/sessions'))).body.data as { id: string }[];
      expect(index.map((s) => s.id)).toContain(kept);
      expect(index.map((s) => s.id)).not.toContain(id);

      // The episode's last activity is the session that was kept.
      const episodes = (await auth(request(app).get(`/api/patients/${patientId}/episodes`))).body.data as {
        id: string;
        lastActivityAt: string | null;
      }[];
      const keptDate = (await prisma.session.findUniqueOrThrow({ where: { id: kept } })).sessionDate.toISOString();
      expect(episodes.find((e) => e.id === episodeId)?.lastActivityAt).toBe(keptDate);
    });

    it('keeps its history readable, with the annulment as its last version', async () => {
      const id = await newSession();
      expect((await annulSession(id, { reason: 'CLARIFICATION' })).status).toBe(204);

      const res = await auth(request(app).get(`${sessionsUrl()}/${id}/revisions`));
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { version: number; action: string }) => [r.version, r.action])).toEqual(
        expect.arrayContaining([
          [1, 'SESSION_RECORDED'],
          [2, 'SESSION_ANNULLED'],
        ]),
      );
    });

    it("answers 404 to another patient's session and to an unknown id", async () => {
      const { id: other } = await fixture.patient.create({
        data: { tenantId: clinic.tenantId, firstName: 'Otra', lastName: 'Paciente' },
        select: { id: true },
      });
      const { id: otherEpisode } = await fixture.clinicalEpisode.create({
        data: { tenantId: clinic.tenantId, patientId: other },
        select: { id: true },
      });
      const created = await auth(request(app).post(`/api/patients/${other}/sessions`)).send({
        sessionDate: new Date().toISOString(),
        episodes: [{ episodeId: otherEpisode }],
      });

      expect((await annulSession(created.body.data.id, { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);
      expect((await annulSession(randomUUID(), { reason: 'DATA_ENTRY_ERROR' })).status).toBe(404);
      expect((await prisma.session.findUniqueOrThrow({ where: { id: created.body.data.id } })).deletedAt).toBeNull();
    });

    it('cannot be deleted any more', async () => {
      const id = await newSession();
      expect((await auth(request(app).delete(`${sessionsUrl()}/${id}`))).status).toBe(404);
      expect((await prisma.session.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });
  });

  describe('a patient event', () => {
    it('records the action with its reason, and a final version with the note', async () => {
      const id = await newEvent();

      const res = await annulEvent(id, { reason: 'DATA_ENTRY_ERROR', reasonNote: '   ' });
      expect(res.status).toBe(204);

      const rows = await auditRows(id);
      expect(rows.map((r) => r.action)).toEqual(['PATIENT_EVENT_RECORDED', 'PATIENT_EVENT_ANNULLED']);
      expect(rows[1].params).toEqual({ kind: 'FRACTURE', reason: 'DATA_ENTRY_ERROR' });
      const [first, last] = await prisma.patientEventRevision.findMany({ where: { patientEventId: id }, orderBy: { version: 'asc' } });
      // A blank note is no note (single empty).
      expect(last).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: null });
      expect(last.snapshot).toEqual(first.snapshot);
    });

    it('answers 400 without a reason and writes nothing', async () => {
      const id = await newEvent();

      expect((await annulEvent(id, {})).status).toBe(400);

      expect((await prisma.patientEvent.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
      expect(await auditRows(id)).toHaveLength(1);
    });

    it('stays in the record marked, cannot be edited, and keeps its history', async () => {
      const id = await newEvent();
      expect((await annulEvent(id, { reason: 'OTHER' })).status).toBe(204);

      const list = (await auth(request(app).get(eventsUrl()))).body.data as { id: string; annulledAt: string | null }[];
      expect(list.find((e) => e.id === id)?.annulledAt).toEqual(expect.any(String));

      const edit = await auth(request(app).patch(`${eventsUrl()}/${id}`)).send({ reason: 'OTHER', description: 'Tarde' });
      expect(edit.status).toBe(404);
      expect((await annulEvent(id, { reason: 'OTHER' })).status).toBe(404);

      const history = await auth(request(app).get(`${eventsUrl()}/${id}/revisions`));
      expect(history.body.data.map((r: { action: string }) => r.action)).toContain('PATIENT_EVENT_ANNULLED');
    });

    it('cannot be deleted any more', async () => {
      const id = await newEvent();
      expect((await auth(request(app).delete(`${eventsUrl()}/${id}`))).status).toBe(404);
      expect((await prisma.patientEvent.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });
  });
});
