import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SESSION_SNAPSHOT_VERSION } from '@ficha/shared';
import { prisma } from '../src/lib/prisma';
import {
  createSessionFixture,
  createTestClinic,
  deleteAuditRows,
  deleteRevisions,
  expectRestrictedDelete,
  inAuditMaintenance,
  type TestClinic,
} from './helpers';

// What the database itself guarantees about a session's versions
// (SPEC-clinical-revisions.md §2, §6), written straight to the table.
describe('session_revisions', () => {
  let clinic: TestClinic;
  let otherClinic: TestClinic;
  let userId: string;
  let otherUserId: string;
  let patient: string;
  let otherPatient: string;
  let foreignPatient: string;

  const newPatient = async (tenantId: string) =>
    (
      await prisma.patient.create({
        data: { tenantId, firstName: 'Con', lastName: 'Versiones' },
        select: { id: true },
      })
    ).id;

  const newSession = () =>
    createSessionFixture({ tenantId: clinic.tenantId, patientId: patient, userId, sessionType: 'NOTE', sessionDate: new Date() });

  const firstRevision = async (sessionId: string) =>
    prisma.sessionRevision.findFirstOrThrow({ where: { sessionId }, orderBy: { version: 'asc' } });

  const auditRowOf = async (tenantId: string, patientId: string, user: string) =>
    (
      await prisma.auditLog.create({
        data: { tenantId, patientId, userId: user, entity: 'PATIENT', entityId: patientId, action: 'PATIENT_CREATED' },
        select: { id: true },
      })
    ).id;

  const revisionOf = (sessionId: string, auditLogId: string, version = 2) => ({
    tenantId: clinic.tenantId,
    patientId: patient,
    sessionId,
    version,
    auditLogId,
    snapshot: {},
    schemaVersion: SESSION_SNAPSHOT_VERSION,
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
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await otherClinic.cleanup();
  });

  it('rejects an update, a delete and a truncate', async () => {
    const { id } = await firstRevision((await newSession()).id);

    await expect(
      prisma.sessionRevision.update({ where: { id }, data: { reasonNote: 'otra cosa' } }),
    ).rejects.toThrow(/audit rows are append-only: UPDATE on session_revisions rejected/);
    await expect(prisma.sessionRevision.delete({ where: { id } })).rejects.toThrow(
      /audit rows are append-only: DELETE on session_revisions rejected/,
    );
    await expect(prisma.$executeRawUnsafe('TRUNCATE session_revisions')).rejects.toThrow(
      /audit rows are append-only: TRUNCATE on session_revisions rejected/,
    );
  });

  it('lets the cleanup helper delete, under maintenance', async () => {
    const session = await newSession();
    await deleteRevisions('session_revisions', [session.id]);

    expect(await prisma.sessionRevision.count({ where: { sessionId: session.id } })).toBe(0);
    await prisma.session.delete({ where: { id: session.id } });
  });

  it('keeps the session it versions from being deleted', async () => {
    const session = await newSession();
    await expectRestrictedDelete(
      prisma.session.delete({ where: { id: session.id } }),
      'session_revisions_tenant_id_patient_id_session_id_fkey',
    );
  });

  it('keeps the audit row it names from being deleted, even under maintenance', async () => {
    const { auditLogId } = await firstRevision((await newSession()).id);
    await expectRestrictedDelete(
      inAuditMaintenance((tx) => tx.auditLog.delete({ where: { id: auditLogId } })),
      'session_revisions_tenant_id_patient_id_audit_log_id_fkey',
    );
  });

  it("refuses an audit row of another patient, or of another clinic's", async () => {
    const session = await newSession();
    const ofOtherPatient = await auditRowOf(clinic.tenantId, otherPatient, userId);
    const ofOtherClinic = await auditRowOf(otherClinic.tenantId, foreignPatient, otherUserId);

    await expect(prisma.sessionRevision.create({ data: revisionOf(session.id, ofOtherPatient) })).rejects.toThrow(
      /session_revisions_tenant_id_patient_id_audit_log_id_fkey/,
    );
    await expect(prisma.sessionRevision.create({ data: revisionOf(session.id, ofOtherClinic) })).rejects.toThrow(
      /session_revisions_tenant_id_patient_id_audit_log_id_fkey/,
    );
  });

  it('refuses a session of another patient', async () => {
    const session = await newSession();
    const { auditLogId } = await firstRevision(session.id);

    await expect(
      prisma.sessionRevision.create({
        data: { ...revisionOf(session.id, auditLogId), patientId: otherPatient },
      }),
    ).rejects.toThrow(/session_revisions_tenant_id_patient_id_session_id_fkey/);
    await expect(
      prisma.sessionRevision.create({ data: revisionOf(randomUUID(), auditLogId) }),
    ).rejects.toThrow(/session_revisions_tenant_id_patient_id_session_id_fkey/);
  });

  it('refuses a version below 1, and the same version twice', async () => {
    const session = await newSession();
    const { auditLogId } = await firstRevision(session.id);

    await expect(prisma.sessionRevision.create({ data: revisionOf(session.id, auditLogId, 0) })).rejects.toThrow(
      /session_revisions_version_positive/,
    );
    await expect(prisma.sessionRevision.create({ data: revisionOf(session.id, auditLogId, 1) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});
