import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import type { RevisionTable } from '../src/repositories/prisma/recordRevision';
import {
  createTestClinic,
  deleteAuditRows,
  deleteRevisions,
  expectRestrictedDelete,
  inAuditMaintenance,
  type TestClinic,
} from './helpers';
import { fixture } from './fixtures';

// What the database itself guarantees about the versions of the patient, the
// episode, the evaluation, the consent and the patient event
// (SPEC-clinical-revisions.md §2, §6), written straight to the tables. The
// session's are in sessionRevisionsTable.test.ts.
describe('the revisions tables of the other five aggregates', () => {
  let clinic: TestClinic;
  let otherClinic: TestClinic;

  interface Aggregate {
    table: Exclude<RevisionTable, 'session_revisions'>;
    // The aggregate's own table, and the revision's column naming it.
    parent: string;
    key: string;
    // Writes one aggregate with version 1, of a patient of `tenantId`.
    create: (tenantId: string) => Promise<{ id: string; patientId: string }>;
  }

  const newPatient = (tenantId: string) =>
    fixture.patient.create({ data: { tenantId, firstName: 'Con', lastName: 'Versiones' } });
  const newEpisode = async (tenantId: string) => {
    const patient = await newPatient(tenantId);
    return fixture.clinicalEpisode.create({ data: { tenantId, patientId: patient.id } });
  };

  const AGGREGATES: Aggregate[] = [
    {
      table: 'patient_revisions',
      parent: 'patients',
      key: 'patient_id',
      create: async (tenantId) => {
        const p = await newPatient(tenantId);
        return { id: p.id, patientId: p.id };
      },
    },
    { table: 'episode_revisions', parent: 'clinical_episodes', key: 'episode_id', create: newEpisode },
    {
      table: 'evaluation_revisions',
      parent: 'initial_evaluations',
      key: 'evaluation_id',
      create: async (tenantId) => {
        const episode = await newEpisode(tenantId);
        return fixture.initialEvaluation.create({
          data: { tenantId, patientId: episode.patientId, episodeId: episode.id },
        });
      },
    },
    {
      table: 'consent_revisions',
      parent: 'informed_consents',
      key: 'consent_id',
      create: async (tenantId) => {
        const patient = await newPatient(tenantId);
        return fixture.informedConsent.create({ data: { tenantId, patientId: patient.id, signedAt: new Date() } });
      },
    },
    {
      table: 'patient_event_revisions',
      parent: 'patient_events',
      key: 'patient_event_id',
      create: async (tenantId) => {
        const patient = await newPatient(tenantId);
        return fixture.patientEvent.create({
          data: { tenantId, patientId: patient.id, kind: 'SURGERY', description: 'Cirugía de rodilla' },
        });
      },
    },
  ];

  beforeAll(async () => {
    clinic = await createTestClinic();
    otherClinic = await createTestClinic();
  });

  afterAll(async () => {
    const tenantIds = [clinic.tenantId, otherClinic.tenantId];
    await deleteAuditRows(tenantIds);
    const where = { where: { tenantId: { in: tenantIds } } };
    await prisma.patientEvent.deleteMany(where);
    await prisma.informedConsent.deleteMany(where);
    await prisma.initialEvaluation.deleteMany(where);
    await prisma.clinicalEpisode.deleteMany(where);
    await prisma.patient.deleteMany(where);
    await clinic.cleanup();
    await otherClinic.cleanup();
  });

  const firstRevision = async ({ table, key }: Aggregate, id: string) => {
    const [row] = await prisma.$queryRawUnsafe<{ id: string; audit_log_id: string }[]>(
      `SELECT id, audit_log_id FROM ${table} WHERE ${key} = $1::uuid AND version = 1`,
      id,
    );
    return row;
  };

  // A version of `aggregate` naming `auditLogId`, through raw SQL. A patient's
  // revision names it in patient_id alone.
  const insertRevision = (
    { table, key }: Aggregate,
    row: { id: string; patientId: string },
    auditLogId: string,
    version = 2,
  ) => {
    const columns: [string, unknown, string][] = [
      ['tenant_id', clinic.tenantId, 'uuid'],
      ['patient_id', row.patientId, 'uuid'],
      ...(key === 'patient_id' ? [] : [[key, row.id, 'uuid'] as [string, unknown, string]]),
      ['version', version, 'int'],
      ['audit_log_id', auditLogId, 'uuid'],
    ];
    return prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (id, ${columns.map(([c]) => c).join(', ')}, snapshot, schema_version)
       VALUES (uuidv7(), ${columns.map(([, , t], i) => `$${i + 1}::${t}`).join(', ')}, '{}'::jsonb, 1)`,
      ...columns.map(([, v]) => v),
    );
  };

  describe.each(AGGREGATES)('$table', (aggregate) => {
    const { table, parent } = aggregate;

    it('rejects an update, a delete and a truncate', async () => {
      const row = await aggregate.create(clinic.tenantId);
      const { id } = await firstRevision(aggregate, row.id);

      await expect(prisma.$executeRawUnsafe(`UPDATE ${table} SET reason_note = 'x' WHERE id = $1::uuid`, id)).rejects.toThrow(
        new RegExp(`audit rows are append-only: UPDATE on ${table} rejected`),
      );
      await expect(prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, id)).rejects.toThrow(
        new RegExp(`audit rows are append-only: DELETE on ${table} rejected`),
      );
      await expect(prisma.$executeRawUnsafe(`TRUNCATE ${table}`)).rejects.toThrow(
        new RegExp(`audit rows are append-only: TRUNCATE on ${table} rejected`),
      );
    });

    it('lets the cleanup helper delete, under maintenance', async () => {
      const row = await aggregate.create(clinic.tenantId);
      await deleteRevisions(table, [row.id]);
      expect(await firstRevision(aggregate, row.id)).toBeUndefined();

      // Gone with it, so the invariant finds no aggregate without a version. A
      // patient goes with her audit rows, which nothing else names.
      if (parent === 'patients') await inAuditMaintenance((tx) => tx.auditLog.deleteMany({ where: { patientId: row.id } }));
      await prisma.$executeRawUnsafe(`DELETE FROM ${parent} WHERE id = $1::uuid`, row.id);
    });

    it('keeps the aggregate it versions, and the audit row it names, from being deleted', async () => {
      const row = await aggregate.create(clinic.tenantId);
      const { audit_log_id } = await firstRevision(aggregate, row.id);

      // A patient's audit rows restrict deleting her first, so for her any
      // RESTRICT will do; the others name their revision's key.
      await expect(prisma.$executeRawUnsafe(`DELETE FROM ${parent} WHERE id = $1::uuid`, row.id)).rejects.toThrow(
        parent === 'patients' ? /violates RESTRICT setting/ : new RegExp(`${table}_tenant_id_patient_id`),
      );
      await expectRestrictedDelete(
        inAuditMaintenance((tx) => tx.auditLog.delete({ where: { id: audit_log_id } })),
        `${table}_tenant_id_patient_id_audit_log_id_fkey`,
      );
    });

    it("refuses an audit row of another patient, or of another clinic's", async () => {
      const row = await aggregate.create(clinic.tenantId);
      const other = await aggregate.create(clinic.tenantId);
      const foreign = await aggregate.create(otherClinic.tenantId);
      const ofOtherPatient = (await firstRevision(aggregate, other.id)).audit_log_id;
      const ofOtherClinic = (await firstRevision(aggregate, foreign.id)).audit_log_id;

      const keyViolation = new RegExp(`${table}_tenant_id_patient_id_audit_log_id_fkey`);
      await expect(insertRevision(aggregate, row, ofOtherPatient)).rejects.toThrow(keyViolation);
      await expect(insertRevision(aggregate, row, ofOtherClinic)).rejects.toThrow(keyViolation);
    });

    it("refuses an aggregate of another clinic's", async () => {
      const foreign = await aggregate.create(otherClinic.tenantId);
      const row = await aggregate.create(clinic.tenantId);
      const { audit_log_id } = await firstRevision(aggregate, row.id);

      // Named with this clinic's tenant: no such aggregate in this clinic.
      await expect(insertRevision(aggregate, foreign, audit_log_id)).rejects.toThrow(/_fkey/);
    });

    it('refuses a version below 1, and the same version twice', async () => {
      const row = await aggregate.create(clinic.tenantId);
      const { audit_log_id } = await firstRevision(aggregate, row.id);

      await expect(insertRevision(aggregate, row, audit_log_id, 0)).rejects.toThrow(
        new RegExp(`${table}_version_positive`),
      );
      await expect(insertRevision(aggregate, row, audit_log_id, 1)).rejects.toThrow(/\(\w+, version\)=.* already exists/);
    });
  });
});
