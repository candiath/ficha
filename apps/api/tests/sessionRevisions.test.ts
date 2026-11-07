import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';

// The write path of a session's versions (SPEC-clinical-revisions.md §5).
describe('session revisions', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patientId: string;
  let episodeA: string;
  let episodeB: string;

  const REASON = { reason: 'DATA_ENTRY_ERROR' };
  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (id = '') => `/api/patients/${patientId}/sessions${id && `/${id}`}`;
  const post = (body: object) => auth(request(app).post(url())).send(body);
  const patch = (id: string, body: object) => auth(request(app).patch(url(id))).send({ ...REASON, ...body });
  const get = async (id: string) => (await auth(request(app).get(url(id)))).body.data;

  const newSession = async (body: object = {}): Promise<string> => {
    const res = await post({ sessionDate: new Date().toISOString(), episodes: [{ episodeId: episodeA, treatment: 'Inicial' }], ...body });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const revisions = (sessionId: string) =>
    prisma.sessionRevision.findMany({ where: { sessionId }, orderBy: { version: 'asc' } });
  const auditRows = (entityId: string) => prisma.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    const { tenantId } = clinic;
    ({ id: patientId } = await prisma.patient.create({
      data: { tenantId, firstName: 'Con', lastName: 'Historia' },
      select: { id: true },
    }));
    const episode = () =>
      prisma.clinicalEpisode.create({ data: { tenantId, patientId, mainComplaint: 'Lumbalgia' }, select: { id: true } });
    // Sorted, so a test can send them out of order on purpose.
    [episodeA, episodeB] = [(await episode()).id, (await episode()).id].sort();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await sleep(200);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where });
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  describe('creating', () => {
    it('writes version 1 with the whole session, under its audit row', async () => {
      const sessionDate = new Date().toISOString();
      const res = await post({
        sessionDate,
        episodes: [{ episodeId: episodeA, treatment: 'Cadena posterior', painScaleBefore: 7 }],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.version).toBe(1);

      const [revision, ...rest] = await revisions(res.body.data.id);
      const [audit] = await auditRows(res.body.data.id);
      expect(rest).toEqual([]);
      expect(revision).toMatchObject({
        version: 1,
        patientId,
        schemaVersion: 1,
        auditLogId: audit.id,
        reasonNote: null,
        snapshot: {
          userId: user.id,
          sessionType: 'SESSION',
          sessionDate,
          observations: null,
          episodes: [
            {
              episodeId: episodeA,
              preSessionState: null,
              treatment: 'Cadena posterior',
              painScaleBefore: 7,
              painScaleAfter: null,
              patientExercises: null,
              reEvaluationNotes: null,
            },
          ],
        },
      });
      expect(audit.action).toBe('SESSION_RECORDED');
    });

    it('links a note and a discharge to their own actions', async () => {
      const note = await newSession({ sessionType: 'NOTE', episodes: [], observations: 'Llamó por teléfono' });
      expect((await auditRows(note))[0].action).toBe('NOTE_RECORDED');
      expect((await revisions(note))[0].snapshot).toMatchObject({ observations: 'Llamó por teléfono', episodes: [] });
    });
  });

  describe('editing', () => {
    it('writes the next version with the new state, its audit row and its note', async () => {
      const id = await newSession();

      const res = await patch(id, {
        reason: 'LATE_INFORMATION',
        reasonNote: '  Lo aclaró la paciente  ',
        episodes: [{ episodeId: episodeA, treatment: 'Corregido' }],
      });

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe(2);
      expect((await get(id)).version).toBe(2);

      const [, second] = await revisions(id);
      const [, audit] = await auditRows(id);
      expect(second).toMatchObject({
        version: 2,
        auditLogId: audit.id,
        reasonNote: 'Lo aclaró la paciente',
        snapshot: { episodes: [{ episodeId: episodeA, treatment: 'Corregido' }] },
      });
      expect(audit.params).toEqual({ sessionType: 'SESSION', changedFields: ['treatment'], reason: 'LATE_INFORMATION' });
    });

    it('treats an empty note as none', async () => {
      const id = await newSession();
      await patch(id, { reasonNote: '   ', episodes: [{ episodeId: episodeA, treatment: 'Otro' }] });
      expect((await revisions(id))[1].reasonNote).toBeNull();
    });

    it('shows a removed block in the next snapshot, and keeps it in the previous one', async () => {
      const id = await newSession({
        episodes: [
          { episodeId: episodeA, treatment: 'Espalda' },
          { episodeId: episodeB, treatment: 'Tobillo' },
        ],
      });

      expect((await patch(id, { episodes: [{ episodeId: episodeA }] })).status).toBe(200);

      const [first, second] = await revisions(id);
      const episodesOf = (r: typeof first) => (r.snapshot as { episodes: { episodeId: string }[] }).episodes.map((b) => b.episodeId);
      expect(episodesOf(first)).toEqual([episodeA, episodeB]);
      expect(episodesOf(second)).toEqual([episodeA]);
    });

    it('keeps the blocks in episode order, however they were sent', async () => {
      const id = await newSession({ episodes: [{ episodeId: episodeB }, { episodeId: episodeA }] });
      const [first] = await revisions(id);
      expect((first.snapshot as { episodes: { episodeId: string }[] }).episodes.map((b) => b.episodeId)).toEqual([episodeA, episodeB]);
    });

    it('rejects a missing or unknown reason, and a malformed version', async () => {
      const id = await newSession();

      const missing = await auth(request(app).patch(url(id))).send({ observations: 'x' });
      expect(missing.status).toBe(400);
      expect(missing.body.details.reason).toEqual(['Elegí el motivo del cambio']);
      expect((await patch(id, { reason: 'PORQUE_SI', observations: 'x' })).status).toBe(400);
      expect((await patch(id, { expectedVersion: -1, observations: 'x' })).status).toBe(400);
      expect((await patch(id, { expectedVersion: '1', observations: 'x' })).status).toBe(400);

      expect(await revisions(id)).toHaveLength(1);
    });
  });

  describe('a save that changes nothing', () => {
    it('answers 200 and writes no row, no audit row and no revision', async () => {
      const id = await newSession({ observations: 'Igual' });
      const before = await get(id);

      const res = await patch(id, {
        sessionDate: before.sessionDate,
        observations: 'Igual',
        episodes: before.episodes,
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(before);
      expect((await get(id)).updatedAt).toBe(before.updatedAt);
      expect(await auditRows(id)).toHaveLength(1);
      expect(await revisions(id)).toHaveLength(1);
    });

    it('sees through the block order and an empty text', async () => {
      const id = await newSession({
        episodes: [
          { episodeId: episodeA, treatment: 'Uno' },
          { episodeId: episodeB, treatment: 'Dos' },
        ],
      });
      const before = await get(id);

      const res = await patch(id, {
        sessionDate: before.sessionDate,
        observations: '   ',
        episodes: [...before.episodes].reverse(),
      });

      expect(res.status).toBe(200);
      expect(await revisions(id)).toHaveLength(1);
    });

    it('matches a block sent with its episode id in uppercase, and keeps the fields it left out', async () => {
      const id = await newSession({ episodes: [{ episodeId: episodeA, treatment: 'Igual', painScaleBefore: 6 }] });

      const res = await patch(id, { episodes: [{ episodeId: episodeA.toUpperCase(), treatment: 'Igual' }] });

      expect(res.status).toBe(200);
      expect(res.body.data.episodes).toEqual([expect.objectContaining({ episodeId: episodeA, painScaleBefore: 6 })]);
      expect(await revisions(id)).toHaveLength(1);
    });

    it('counts a real change after one, once', async () => {
      const id = await newSession();
      await patch(id, {});
      await patch(id, { observations: 'Ahora sí' });
      await patch(id, { observations: 'Ahora sí' });
      expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2]);
    });
  });

  describe('a session from before revisions (version 0)', () => {
    it('is version 0 until its first edit, which writes version 1', async () => {
      const { id } = await prisma.session.create({
        data: { tenantId: clinic.tenantId, patientId, userId: user.id, sessionDate: new Date(), observations: 'Antigua', sessionType: 'NOTE' },
        select: { id: true },
      });
      expect((await get(id)).version).toBe(0);

      // Nothing to version in a save that changes nothing.
      expect((await patch(id, { observations: 'Antigua', expectedVersion: 0 })).status).toBe(200);
      expect(await revisions(id)).toHaveLength(0);

      const res = await patch(id, { observations: 'Corregida', expectedVersion: 0 });
      expect(res.body.data.version).toBe(1);
      expect((await revisions(id))[0].snapshot).toMatchObject({ observations: 'Corregida' });
    });
  });

  describe('deleting', () => {
    it('writes a version with the same content, under SESSION_DELETED', async () => {
      const id = await newSession();

      expect((await auth(request(app).delete(url(id)))).status).toBe(204);

      const [first, second] = await revisions(id);
      const rows = await auditRows(id);
      expect(second).toMatchObject({ version: 2, auditLogId: rows[1].id });
      expect(second.snapshot).toEqual(first.snapshot);
      expect(rows[1].action).toBe('SESSION_DELETED');
    });

    it('writes nothing for a session that was not deleted', async () => {
      const id = await newSession({ payment: { baseAmountCents: 100 } });
      await prisma.payment.updateMany({ where: { sessionId: id }, data: { status: 'PAID', paidAt: new Date(), method: 'CASH' } });

      expect((await auth(request(app).delete(url(id)))).status).toBe(409);
      expect(await revisions(id)).toHaveLength(1);

      await prisma.payment.deleteMany({ where: { sessionId: id } });
    });
  });

  describe('a failed revision', () => {
    // Postgres puts the failing row in the detail of a CHECK violation, which is
    // what a log must never repeat. NOT VALID: it only refuses new rows.
    it('rolls the edit back, and logs code, table and id with no clinical text', async () => {
      const id = await newSession({ observations: 'Antes' });
      const logged = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')].map((spy) =>
        spy.mockImplementation(() => undefined),
      );

      await prisma.$executeRawUnsafe(
        'ALTER TABLE session_revisions ADD CONSTRAINT test_refuses_every_revision CHECK (false) NOT VALID',
      );
      try {
        const res = await patch(id, { observations: 'MARCADOR-CLINICO', reasonNote: 'NOTA-CLINICA' });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('MARCADOR');
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE session_revisions DROP CONSTRAINT test_refuses_every_revision');
      }

      expect((await get(id)).observations).toBe('Antes');
      expect(await auditRows(id)).toHaveLength(1);
      expect(await revisions(id)).toHaveLength(1);

      const output = logged.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(' ')).join('\n');
      expect(output).toContain(`code=23514 table=session_revisions id=${id}`);
      expect(output).not.toContain('MARCADOR-CLINICO');
      expect(output).not.toContain('NOTA-CLINICA');
    });
  });

  describe('stale edits', () => {
    it('answers 409 to a version that is not the latest, and writes nothing', async () => {
      const id = await newSession();
      expect((await patch(id, { observations: 'Primera', expectedVersion: 1 })).status).toBe(200);

      const res = await patch(id, { observations: 'Pisada', expectedVersion: 1 });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: STALE });
      expect((await get(id)).observations).toBe('Primera');
      expect(await revisions(id)).toHaveLength(2);
      expect(await auditRows(id)).toHaveLength(2);
    });

    it('answers 409 to a stale save even if it changes nothing', async () => {
      const id = await newSession();
      await patch(id, { observations: 'Primera' });
      expect((await patch(id, { observations: 'Primera', expectedVersion: 1 })).status).toBe(409);
    });

    it('lets one of two concurrent edits of the same version through', async () => {
      const id = await newSession();

      const results = await Promise.all([
        patch(id, { observations: 'Una', expectedVersion: 1 }),
        patch(id, { observations: 'Otra', expectedVersion: 1 }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = results.find((r) => r.status === 200)!;
      const history = await revisions(id);
      expect(history.map((r) => r.version)).toEqual([1, 2]);
      expect(history[1].snapshot).toMatchObject({ observations: winner.body.data.observations });
    });

    it('without a version, makes consecutive versions of two concurrent edits: none is lost', async () => {
      const id = await newSession();

      const results = await Promise.all([patch(id, { observations: 'Una' }), patch(id, { observations: 'Otra' })]);

      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const history = await revisions(id);
      expect(history.map((r) => r.version)).toEqual([1, 2, 3]);
      const texts = history.slice(1).map((r) => (r.snapshot as { observations: string }).observations);
      expect(texts.sort()).toEqual(['Otra', 'Una']);
    });

    it('a concurrent edit and delete take consecutive versions, or the edit finds no session', async () => {
      const id = await newSession();

      const [edit, removal] = await Promise.all([
        patch(id, { observations: 'Editada' }),
        auth(request(app).delete(url(id))),
      ]);

      expect(removal.status).toBe(204);
      expect([200, 404]).toContain(edit.status);
      expect((await revisions(id)).map((r) => r.version)).toEqual(edit.status === 200 ? [1, 2, 3] : [1, 2]);
    });
  });

  it("carries the version in the patient's list", async () => {
    const id = await newSession();
    await patch(id, { observations: 'Editada' });

    const list = await auth(request(app).get(url()));
    expect(list.body.data.find((s: { id: string }) => s.id === id).version).toBe(2);
  });
});
