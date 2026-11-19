import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ENCOUNTER_SNAPSHOT_VERSION } from '@ficha/shared';
import { prisma } from '../src/lib/prisma';
import {
  createEncounterFixture,
  createTestClinic,
  deleteAuditRows,
  deleteRevisions,
  expectRestrictedDelete,
  inAuditMaintenance,
  type TestClinic,
} from './helpers';
import { fixture } from './fixtures';

// What the database itself guarantees about an encounter's versions
// (SPEC-clinical-revisions.md §2, §6), written straight to the table.
describe('encounter_revisions', () => {
  let clinic: TestClinic;
  let otherClinic: TestClinic;
  let userId: string;
  let otherUserId: string;
  let patient: string;
  let otherPatient: string;
  let foreignPatient: string;

  const newPatient = async (tenantId: string) =>
    (
      await fixture.patient.create({
        data: { tenantId, firstName: 'Con', lastName: 'Versiones' },
        select: { id: true },
      })
    ).id;

  const newEncounter = () =>
    createEncounterFixture({ tenantId: clinic.tenantId, patientId: patient, userId, encounterType: 'NOTE', encounterDate: new Date() });

  const firstRevision = async (encounterId: string) =>
    prisma.encounterRevision.findFirstOrThrow({ where: { encounterId }, orderBy: { version: 'asc' } });

  const auditRowOf = async (tenantId: string, patientId: string, user: string) =>
    (
      await prisma.auditLog.create({
        data: { tenantId, patientId, userId: user, entity: 'PATIENT', entityId: patientId, action: 'PATIENT_CREATED' },
        select: { id: true },
      })
    ).id;

  const revisionOf = (encounterId: string, auditLogId: string, version = 2) => ({
    tenantId: clinic.tenantId,
    patientId: patient,
    encounterId,
    version,
    auditLogId,
    snapshot: {},
    schemaVersion: ENCOUNTER_SNAPSHOT_VERSION,
  });

  beforeAll(async () => {
    clinic = await createTestClinic();
    otherClinic = await createTestClinic();
    userId = (await clinic.createUser()).id;
    otherUserId = (await otherClinic.createUser()).id;
    patient = await newPatient(clinic.tenantId);
    otherPatient = await newPatient(clinic.tenantId);
    foreignPatient = await newPatient(otherClinic.tenantId);
  });

  afterAll(async () => {
    const tenantIds = [clinic.tenantId, otherClinic.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.encounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await otherClinic.cleanup();
  });

  it('rejects an update, a delete and a truncate', async () => {
    const { id } = await firstRevision((await newEncounter()).id);

    await expect(
      prisma.encounterRevision.update({ where: { id }, data: { reasonNote: 'otra cosa' } }),
    ).rejects.toThrow(/audit rows are append-only: UPDATE on encounter_revisions rejected/);
    await expect(prisma.encounterRevision.delete({ where: { id } })).rejects.toThrow(
      /audit rows are append-only: DELETE on encounter_revisions rejected/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE encounter_revisions')).rejects.toThrow(
      /audit rows are append-only: TRUNCATE on encounter_revisions rejected/,
    );
  });

  it('lets the cleanup helper delete, under maintenance', async () => {
    const encounter = await newEncounter();
    await deleteRevisions('encounter_revisions', [encounter.id]);

    expect(await prisma.encounterRevision.count({ where: { encounterId: encounter.id } })).toBe(0);
    await prisma.encounter.delete({ where: { id: encounter.id } });
  });

  it('keeps the encounter it versions from being deleted', async () => {
    const encounter = await newEncounter();
    await expectRestrictedDelete(
      prisma.encounter.delete({ where: { id: encounter.id } }),
      'encounter_revisions_tenant_id_patient_id_encounter_id_fkey',
    );
  });

  it('keeps the audit row it names from being deleted, even under maintenance', async () => {
    const { auditLogId } = await firstRevision((await newEncounter()).id);
    await expectRestrictedDelete(
      inAuditMaintenance((tx) => tx.auditLog.delete({ where: { id: auditLogId } })),
      'encounter_revisions_tenant_id_patient_id_audit_log_id_fkey',
    );
  });

  it("refuses an audit row of another patient, or of another clinic's", async () => {
    const encounter = await newEncounter();
    const ofOtherPatient = await auditRowOf(clinic.tenantId, otherPatient, userId);
    const ofOtherClinic = await auditRowOf(otherClinic.tenantId, foreignPatient, otherUserId);

    await expect(prisma.encounterRevision.create({ data: revisionOf(encounter.id, ofOtherPatient) })).rejects.toThrow(
      /encounter_revisions_tenant_id_patient_id_audit_log_id_fkey/,
    );
    await expect(prisma.encounterRevision.create({ data: revisionOf(encounter.id, ofOtherClinic) })).rejects.toThrow(
      /encounter_revisions_tenant_id_patient_id_audit_log_id_fkey/,
    );
  });

  it('refuses an encounter of another patient', async () => {
    const encounter = await newEncounter();
    const { auditLogId } = await firstRevision(encounter.id);

    await expect(
      prisma.encounterRevision.create({
        data: { ...revisionOf(encounter.id, auditLogId), patientId: otherPatient },
      }),
    ).rejects.toThrow(/encounter_revisions_tenant_id_patient_id_encounter_id_fkey/);
    await expect(
      prisma.encounterRevision.create({ data: revisionOf(randomUUID(), auditLogId) }),
    ).rejects.toThrow(/encounter_revisions_tenant_id_patient_id_encounter_id_fkey/);
  });

  it('refuses a version below 1, and the same version twice', async () => {
    const encounter = await newEncounter();
    const { auditLogId } = await firstRevision(encounter.id);

    await expect(prisma.encounterRevision.create({ data: revisionOf(encounter.id, auditLogId, 0) })).rejects.toThrow(
      /encounter_revisions_version_positive/,
    );
    await expect(prisma.encounterRevision.create({ data: revisionOf(encounter.id, auditLogId, 1) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});
