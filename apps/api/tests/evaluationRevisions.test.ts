import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// The write path of an initial evaluation's versions (SPEC-clinical-revisions.md
// §5). The PUT is an upsert: the first one creates (no reason), every later one
// corrects (a reason).
describe('evaluation revisions', () => {
  let clinic: TestClinic;
  let token: string;
  let patientId: string;

  const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (episodeId: string) => `/api/patients/${patientId}/episodes/${episodeId}/evaluation`;
  const put = (episodeId: string, body: object) => auth(request(app).put(url(episodeId))).send(body);

  const newEpisode = async () =>
    (await fixture.clinicalEpisode.create({ data: { tenantId: clinic.tenantId, patientId, mainComplaint: 'Lumbalgia' } })).id;
  const revisionsOf = async (episodeId: string) => {
    const evaluation = await prisma.initialEvaluation.findUniqueOrThrow({ where: { episodeId } });
    return prisma.evaluationRevision.findMany({ where: { evaluationId: evaluation.id }, orderBy: { version: 'asc' } });
  };
  const auditRows = (entityId: string) =>
    prisma.auditLog.findMany({ where: { entityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    clinic = await createTestClinic();
    token = await createTestToken(await clinic.createUser());
    ({ id: patientId } = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Con', lastName: 'Evaluación' },
    }));
  });

  afterAll(async () => {
    await sleep(200);
    const where = { tenantId: clinic.tenantId };
    await deleteAuditRows([clinic.tenantId]);
    await prisma.initialEvaluation.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
  });

  it('writes version 1 on the first save, with no reason, and the next on a correction', async () => {
    const episodeId = await newEpisode();

    const first = await put(episodeId, { notes: 'Primera', evaScale: 6, retractionMap: [{ x: 1 }], expectedVersion: 0 });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(1);

    const second = await put(episodeId, {
      evaScale: 4,
      reason: 'LATE_INFORMATION',
      reasonNote: 'Lo trajo escrito',
      expectedVersion: 1,
    });
    expect(second.status).toBe(200);
    expect(second.body.data.version).toBe(2);

    const [v1, v2] = await revisionsOf(episodeId);
    const rows = await auditRows(first.body.data.id);
    expect(rows.map((r) => [r.action, r.params])).toEqual([
      ['EVALUATION_CREATED', {}],
      ['EVALUATION_UPDATED', { changedFields: ['evaScale'], reason: 'LATE_INFORMATION' }],
    ]);
    expect(v1).toMatchObject({ version: 1, auditLogId: rows[0].id, reasonNote: null });
    expect(v1.snapshot).toMatchObject({ notes: 'Primera', evaScale: 6, retractionMap: [{ x: 1 }] });
    expect(v2).toMatchObject({ version: 2, auditLogId: rows[1].id, reasonNote: 'Lo trajo escrito' });
    expect(v2.snapshot).toMatchObject({ notes: 'Primera', evaScale: 4 });
  });

  it('requires a reason to correct, and none to create', async () => {
    const episodeId = await newEpisode();
    expect((await put(episodeId, { notes: 'Primera' })).status).toBe(200);

    const res = await put(episodeId, { notes: 'Segunda' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Elegí el motivo del cambio');
    expect((await prisma.initialEvaluation.findUniqueOrThrow({ where: { episodeId } })).notes).toBe('Primera');
    expect(await revisionsOf(episodeId)).toHaveLength(1);
  });

  it('answers 200 to a save that changes nothing, and writes nothing', async () => {
    const episodeId = await newEpisode();
    const first = await put(episodeId, { notes: 'Igual', retractionMap: { b: 1, a: 2 } });

    const res = await put(episodeId, { notes: 'Igual', retractionMap: { a: 2, b: 1 }, reason: 'DATA_ENTRY_ERROR' });

    expect(res.status).toBe(200);
    expect(res.body.data.updatedAt).toBe(first.body.data.updatedAt);
    expect(await auditRows(first.body.data.id)).toHaveLength(1);
    expect(await revisionsOf(episodeId)).toHaveLength(1);
  });

  it('answers 409 to a stale version, a first save included, and writes nothing', async () => {
    const episodeId = await newEpisode();
    await put(episodeId, { notes: 'Primera' });

    // Another form, opened before the first evaluation existed.
    const res = await put(episodeId, { notes: 'Otra primera', expectedVersion: 0 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(STALE);
    expect(await revisionsOf(episodeId)).toHaveLength(1);
  });

  it('lets one of two concurrent first evaluations through', async () => {
    const episodeId = await newEpisode();
    const results = await Promise.all([
      put(episodeId, { notes: 'Una', expectedVersion: 0 }),
      put(episodeId, { notes: 'Otra', expectedVersion: 0 }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await revisionsOf(episodeId)).map((r) => r.version)).toEqual([1]);
  });

  it('without a version, makes consecutive versions of two concurrent saves: none is lost', async () => {
    const episodeId = await newEpisode();
    const results = await Promise.all([
      put(episodeId, { notes: 'Una', reason: 'DATA_ENTRY_ERROR' }),
      put(episodeId, { painFrequency: 'Diario', reason: 'DATA_ENTRY_ERROR' }),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const all = await revisionsOf(episodeId);
    expect(all.map((r) => r.version)).toEqual([1, 2]);
    expect(all[1].snapshot).toMatchObject({ notes: 'Una', painFrequency: 'Diario' });
  });
});
