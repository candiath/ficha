import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// The write path of an episode's versions (SPEC-clinical-revisions.md §4, §5),
// and the discharge, which versions the session and the episodes it closes
// under one audit row.
describe('episode revisions', () => {
  let clinic: TestClinic;
  let token: string;
  let patientId: string;
  let userId: string;

  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (id = '') => `/api/patients/${patientId}/episodes${id && `/${id}`}`;
  const patch = (id: string, body: object) => auth(request(app).patch(url(id))).send(body);

  const newEpisode = async (): Promise<string> => {
    const res = await auth(request(app).post(url())).send({
      mainComplaint: 'Lumbalgia',
      openedAt: '2026-01-01T12:00:00.000Z',
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };

  const revisions = (episodeId: string) =>
    prisma.episodeRevision.findMany({ where: { episodeId }, orderBy: { version: 'asc' } });
  const auditRows = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const discharge = (episodeId: string) =>
    auth(request(app).post(`/api/patients/${patientId}/sessions`)).send({
      sessionType: 'DISCHARGE',
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId }],
    });

  beforeAll(async () => {
    clinic = await createTestClinic();
    const user = await clinic.createUser();
    userId = user.id;
    token = await createTestToken(user);
    ({ id: patientId } = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Con', lastName: 'Episodios' },
    }));
  });

  afterAll(async () => {
    await sleep(200);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where });
    await prisma.appointment.deleteMany({ where });
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('writes version 1 on opening, under EPISODE_OPENED', async () => {
    const id = await newEpisode();
    const [revision, ...rest] = await revisions(id);
    const [audit] = await auditRows(id);

    expect(rest).toEqual([]);
    expect(audit.action).toBe('EPISODE_OPENED');
    expect(revision).toMatchObject({ version: 1, auditLogId: audit.id, schemaVersion: 1 });
    expect(revision.snapshot).toEqual({
      status: 'ACTIVE',
      mainComplaint: 'Lumbalgia',
      openedAt: '2026-01-01T12:00:00.000Z',
      closedAt: null,
    });
  });

  it('versions a correction with its reason and note', async () => {
    const id = await newEpisode();
    const res = await patch(id, {
      mainComplaint: 'Lumbociatalgia',
      reason: 'CLARIFICATION',
      reasonNote: 'Irradia a la pierna',
      expectedVersion: 1,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(2);
    const [, second] = await revisions(id);
    const [, audit] = await auditRows(id);
    expect(audit).toMatchObject({
      action: 'EPISODE_UPDATED',
      params: { changedFields: ['mainComplaint'], reason: 'CLARIFICATION' },
    });
    expect(second).toMatchObject({ version: 2, auditLogId: audit.id, reasonNote: 'Irradia a la pierna' });
    expect(second.snapshot).toMatchObject({ mainComplaint: 'Lumbociatalgia' });
  });

  it('requires a reason for a correction, and none for closing or reopening', async () => {
    const id = await newEpisode();

    const noReason = await patch(id, { mainComplaint: 'Sin motivo' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe('Elegí el motivo del cambio');
    expect(await revisions(id)).toHaveLength(1);

    const closed = await patch(id, { status: 'ABANDONED', closedAt: '2026-02-01T12:00:00.000Z', expectedVersion: 1 });
    const reopened = await patch(id, { status: 'ACTIVE', expectedVersion: 2 });
    expect([closed.status, reopened.status]).toEqual([200, 200]);

    const all = await revisions(id);
    const rows = await auditRows(id);
    expect(rows.map((r) => [r.action, r.params])).toEqual([
      ['EPISODE_OPENED', {}],
      ['EPISODE_CLOSED', { status: 'ABANDONED' }],
      ['EPISODE_REOPENED', {}],
    ]);
    expect(all.map((r) => [r.version, r.auditLogId, r.reasonNote])).toEqual([
      [1, rows[0].id, null],
      [2, rows[1].id, null],
      [3, rows[2].id, null],
    ]);
    expect(all[1].snapshot).toMatchObject({ status: 'ABANDONED', closedAt: '2026-02-01T12:00:00.000Z' });
    expect(all[2].snapshot).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  it('answers 200 to a save that changes nothing, and writes nothing', async () => {
    const id = await newEpisode();
    const [before] = await prisma.clinicalEpisode.findMany({ where: { id } });

    const res = await patch(id, { mainComplaint: 'Lumbalgia', reason: 'DATA_ENTRY_ERROR', expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect((await prisma.clinicalEpisode.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(before.updatedAt);
    expect(await auditRows(id)).toHaveLength(1);
    expect(await revisions(id)).toHaveLength(1);
  });

  it('answers 409 to a stale version, and writes nothing', async () => {
    const id = await newEpisode();
    await patch(id, { mainComplaint: 'Primera', reason: 'DATA_ENTRY_ERROR' });

    const res = await patch(id, { status: 'ABANDONED', closedAt: '2026-02-01T12:00:00.000Z', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(STALE);
    expect(await revisions(id)).toHaveLength(2);
  });

  it('lets one of two concurrent edits of the same version through', async () => {
    const id = await newEpisode();
    const results = await Promise.all([
      patch(id, { mainComplaint: 'Una', reason: 'DATA_ENTRY_ERROR', expectedVersion: 1 }),
      patch(id, { mainComplaint: 'Otra', reason: 'DATA_ENTRY_ERROR', expectedVersion: 1 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2]);
  });

  describe('a discharge', () => {
    it('writes the session and the closed episode under its one audit row', async () => {
      const id = await newEpisode();
      await patch(id, { mainComplaint: 'Lumbalgia crónica', reason: 'DATA_ENTRY_ERROR' });

      const res = await discharge(id);
      expect(res.status).toBe(201);

      const [audit, ...others] = await auditRows(res.body.data.id);
      expect(others).toEqual([]);
      expect(audit.action).toBe('DISCHARGE_RECORDED');
      const sessionRevisions = await prisma.sessionRevision.findMany({ where: { auditLogId: audit.id } });
      const episodeRevisions = await prisma.episodeRevision.findMany({ where: { auditLogId: audit.id } });
      expect(sessionRevisions.map((r) => [r.sessionId, r.version])).toEqual([[res.body.data.id, 1]]);
      // Consecutive: after the opening and the correction.
      expect(episodeRevisions.map((r) => [r.episodeId, r.version])).toEqual([[id, 3]]);
      expect(episodeRevisions[0].snapshot).toMatchObject({ status: 'DISCHARGED', mainComplaint: 'Lumbalgia crónica' });
      // The discharge wrote no episode audit row of its own: one action, one row.
      expect((await auditRows(id)).map((r) => r.action)).toEqual(['EPISODE_OPENED', 'EPISODE_UPDATED']);
    });

    it('does not deadlock with a concurrent edit of its episode', async () => {
      for (let round = 0; round < 3; round++) {
        const id = await newEpisode();
        const [closing, edit] = await Promise.all([
          discharge(id),
          patch(id, { mainComplaint: `Editado ${round}`, reason: 'DATA_ENTRY_ERROR' }),
        ]);

        expect([closing.status, edit.status]).toEqual([201, 200]);
        expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2, 3]);
      }
    });

    // The discharge locks its episode and later links its appointment; an edit
    // of that appointment locks it and then points it at the episode, whose
    // foreign key check takes a share lock on the episode. If the lock on the
    // episode blocked that share lock (FOR UPDATE does, FOR NO KEY UPDATE does
    // not), each would wait on the other. A transaction holding the patient
    // stops both where the cycle would form: the discharge at its session's
    // insert, holding the episode; the edit at its audit row, after the
    // episode's share lock, or at that share lock if it is blocked.
    it('does not deadlock with an edit that points its appointment at the episode', async () => {
      const id = await newEpisode();
      const appointment = await prisma.appointment.create({
        data: {
          tenantId: clinic.tenantId,
          patientId,
          userId,
          startsAt: new Date('2026-02-01T13:00:00.000Z'),
          endsAt: new Date('2026-02-01T14:00:00.000Z'),
        },
        select: { id: true },
      });

      const waiting = async () => {
        const [{ count }] = await prisma.$queryRaw<[{ count: number }]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        return count;
      };
      const until = async (condition: () => Promise<boolean>) => {
        for (let i = 0; i < 200 && !(await condition()); i++) await sleep(25);
      };

      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let holding!: () => void;
      const held = new Promise<void>((resolve) => (holding = resolve));
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "patients" WHERE "id" = ${patientId}::uuid FOR UPDATE`;
          holding();
          await released;
        },
        { timeout: 20_000 },
      );
      await held;

      const closing = auth(request(app).post(`/api/patients/${patientId}/sessions`))
        .send({
          sessionType: 'DISCHARGE',
          sessionDate: new Date().toISOString(),
          episodes: [{ episodeId: id }],
          appointmentId: appointment.id,
        })
        .then((r) => r);
      await until(async () => (await waiting()) >= 1);
      expect(await waiting()).toBeGreaterThanOrEqual(1);
      const edit = auth(request(app).patch(`/api/appointments/${appointment.id}`))
        .send({ episodeId: id })
        .then((r) => r);
      await until(async () => (await waiting()) >= 2);
      expect(await waiting()).toBeGreaterThanOrEqual(2);
      release();
      await holder;

      const [closed, edited] = await Promise.all([closing, edit]);
      expect([closed.status, edited.status]).toEqual([201, 200]);
      expect(await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).toMatchObject({
        episodeId: id,
        sessionId: closed.body.data.id,
        status: 'COMPLETED',
      });
    });

    it('takes consecutive versions when two discharge the same episode at once', async () => {
      const id = await newEpisode();
      const results = await Promise.all([discharge(id), discharge(id)]);

      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect((await revisions(id)).map((r) => r.version)).toEqual([1, 2, 3]);
    });
  });
});
