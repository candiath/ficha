import { Prisma } from '@prisma/client';
import { AUDIT_PATIENT_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { fullName, patientNameSelect } from './patientName';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';
import { latestRevision, recordRevision, Rollback, unlessRolledBack } from './recordRevision';
import { dayOrNull, patientSnapshot } from './clinicalSnapshots';
import type {
  DeletedPatientDTO,
  DocumentHolder,
  PatientCreateInput,
  PatientCreateResult,
  PatientAuditField,
  PatientDTO,
  PatientEditMeta,
  PatientRecordDTO,
  PatientRepository,
  PatientUpdateInput,
  PatientUpdateResult,
} from '../patientRepository';

// tenantId y deletedAt se excluyen a propósito: el primero es interno,
// el segundo siempre es null acá (el repo solo devuelve vigentes).
const patientSelect = {
  id: true,
  ...patientNameSelect,
  birthDate: true,
  sex: true,
  documentType: true,
  documentNumber: true,
  phone: true,
  occupation: true,
  referringDoctor: true,
  insuranceName: true,
  insuranceNumber: true,
  insurancePlan: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PatientRow = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: Date | null;
  sex: PatientDTO['sex'];
  documentType: PatientDTO['documentType'];
  documentNumber: string | null;
  phone: string | null;
  occupation: string | null;
  referringDoctor: string | null;
  insuranceName: string | null;
  insuranceNumber: string | null;
  insurancePlan: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const AUDIT_FIELDS = Object.keys(AUDIT_PATIENT_FIELDS) as PatientAuditField[];

function toDTO(row: PatientRow): PatientDTO {
  return {
    ...row,
    fullName: fullName(row),
    birthDate: dayOrNull(row.birthDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The latest version of each patient read here; none is version 0.
const withVersion = {
  ...patientSelect,
  revisions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} as const;

function toRecordDTO({ revisions, ...row }: PatientRow & { revisions: { version: number }[] }): PatientRecordDTO {
  return { ...toDTO(row), version: revisions[0]?.version ?? 0 };
}

// The unique key on (clinic, document type, document number) refused the write.
// The patients table has no other unique key a write here could hit.
function isDocumentTaken(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// Who has the document a write was just refused for, deleted or not. Read
// after the refused transaction ended: null if she is gone by then, or if the
// write named no document at all.
async function documentHolder(
  ctx: TenantContext,
  document: { documentType?: PatientDTO['documentType']; documentNumber?: string | null },
): Promise<DocumentHolder | null> {
  if (!document.documentType || !document.documentNumber) return null;
  const row = await forTenant(ctx).patient.findFirst({
    where: { documentType: document.documentType, documentNumber: document.documentNumber },
    select: { id: true, ...patientNameSelect, deletedAt: true },
  });
  return row ? { id: row.id, fullName: fullName(row), deleted: row.deletedAt !== null } : null;
}

async function getById(ctx: TenantContext, id: string): Promise<PatientRecordDTO | null> {
  const db = forTenant(ctx);
  const row = await db.patient.findFirst({
    where: { id, deletedAt: null },
    select: withVersion,
  });
  return row ? toRecordDTO(row) : null;
}

export const prismaPatientRepository: PatientRepository = {
  async list(ctx: TenantContext): Promise<PatientDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.patient.findMany({
      where: { deletedAt: null },
      select: patientSelect,
      // By surname, as the clinic looks patients up (#238).
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(toDTO);
  },

  getById,

  async exists(ctx: TenantContext, id: string): Promise<boolean> {
    const db = forTenant(ctx);
    const row = await db.patient.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  },

  // Every write below records its audit row and its version in the same
  // transaction (#188, SPEC-clinical-revisions.md §5).

  async create(
    ctx: TenantContext,
    input: PatientCreateInput,
    audit: AuditBuilder<PatientDTO>,
  ): Promise<PatientCreateResult> {
    const db = forTenant(ctx);
    try {
      return await db.$transaction(async (tx): Promise<PatientCreateResult> => {
        const row = await tx.patient.create({
          data: { ...input, tenantId: ctx.tenantId },
          select: patientSelect,
        });
        const patient = toDTO(row);
        const auditLogId = await recordAudit(tx, ctx, audit(patient));
        await recordRevision(tx, ctx, 'patient_revisions', {
          aggregateId: row.id,
          patientId: row.id,
          version: 1,
          auditLogId,
          snapshot: patientSnapshot(row),
        });
        return { ok: true, patient: { ...patient, version: 1 } };
      });
    } catch (e) {
      if (!isDocumentTaken(e)) throw e;
      return { ok: false, reason: 'document_taken', holder: await documentHolder(ctx, input) };
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    { expectedVersion, reasonNote, ...input }: PatientUpdateInput & PatientEditMeta,
    audit: AuditUpdateBuilder<PatientDTO, PatientAuditField>,
  ): Promise<PatientUpdateResult> {
    const db = forTenant(ctx);
    return unlessRolledBack(
      db.$transaction(async (tx): Promise<PatientUpdateResult> => {
        // Locked and read first: a concurrent edit waits for this one, and then
        // reads the version this one wrote.
        await lockRow(tx, 'patients', id, ctx.tenantId);
        const before = await tx.patient.findFirst({
          where: { id, tenantId: ctx.tenantId, deletedAt: null },
          select: patientSelect,
        });
        if (!before) return { ok: false, reason: 'not_found' };

        const latest = await latestRevision(tx, ctx.tenantId, 'patient_revisions', id);
        const version = latest?.version ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== version) return { ok: false, reason: 'stale' };

        // updateMany y no update: el where con deletedAt hace que existencia,
        // pertenencia y vigencia se decidan en la misma query que escribe.
        const { count } = await tx.patient.updateMany({
          where: { id, tenantId: ctx.tenantId, deletedAt: null },
          data: input,
        });
        if (count === 0) return { ok: false, reason: 'not_found' };
        const row = await tx.patient.findFirstOrThrow({
          where: { id, tenantId: ctx.tenantId },
          select: patientSelect,
        });
        const patient = toDTO(row);

        // Compared after the write, with the same select and mapping as the
        // snapshot: a write that changed nothing is rolled back whole, so it
        // leaves no update, no audit row and no version.
        const changed = nonEmpty(changedFields(toDTO(before), patient, AUDIT_FIELDS));
        if (!changed) throw new Rollback<PatientUpdateResult>({ ok: true, patient: { ...toDTO(before), version } });

        const auditLogId = await recordAudit(tx, ctx, audit(patient, changed));
        // Every write takes a version, a change only to contact or coverage
        // included: their values are not in the snapshot, so that version repeats
        // the last content and its audit row names what changed. Otherwise a form
        // loaded before a phone change would pass `expectedVersion` and save the
        // old phone back.
        await recordRevision(tx, ctx, 'patient_revisions', {
          aggregateId: id,
          patientId: id,
          version: version + 1,
          auditLogId,
          snapshot: patientSnapshot(row),
          reasonNote,
        });
        return { ok: true, patient: { ...patient, version: version + 1 } };
      }),
    ).catch(async (e: unknown): Promise<PatientUpdateResult> => {
      if (!isDocumentTaken(e)) throw e;
      return { ok: false, reason: 'document_taken', holder: await documentHolder(ctx, input) };
    });
  },

  async softDelete(ctx: TenantContext, id: string, audit: AuditEntry): Promise<boolean> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // Locked first: this write takes a version, so it waits for a concurrent
      // edit and then reads the version that edit wrote.
      await lockRow(tx, 'patients', id, ctx.tenantId);
      // El deletedAt: null del where hace el borrado idempotente hacia afuera:
      // borrar dos veces da 404 la segunda, no re-marca la fila.
      const { count } = await tx.patient.updateMany({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return false;
      // A version with the same content: the deletion is what its audit row
      // says (SPEC-clinical-revisions.md §1, §8).
      const auditLogId = await recordAudit(tx, ctx, audit);
      const row = await tx.patient.findUniqueOrThrow({ where: { id, tenantId: ctx.tenantId }, select: withVersion });
      await recordRevision(tx, ctx, 'patient_revisions', {
        aggregateId: id,
        patientId: id,
        version: (row.revisions[0]?.version ?? 0) + 1,
        auditLogId,
        snapshot: patientSnapshot(row),
      });
      return true;
    });
  },

  async restore(ctx: TenantContext, id: string, audit: AuditEntry): Promise<boolean> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // The mirror of softDelete: locked first, decided in the write's where
      // (restoring twice is 404 the second time), and a version of unchanged
      // content under its own audit row.
      await lockRow(tx, 'patients', id, ctx.tenantId);
      const { count } = await tx.patient.updateMany({
        where: { id, tenantId: ctx.tenantId, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      if (count === 0) return false;
      const auditLogId = await recordAudit(tx, ctx, audit);
      const row = await tx.patient.findUniqueOrThrow({ where: { id, tenantId: ctx.tenantId }, select: withVersion });
      await recordRevision(tx, ctx, 'patient_revisions', {
        aggregateId: id,
        patientId: id,
        version: (row.revisions[0]?.version ?? 0) + 1,
        auditLogId,
        snapshot: patientSnapshot(row),
      });
      return true;
    });
  },

  async listDeleted(ctx: TenantContext): Promise<DeletedPatientDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.patient.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, ...patientNameSelect, deletedAt: true },
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({ id: r.id, fullName: fullName(r), deletedAt: r.deletedAt!.toISOString() }));
  },
};
