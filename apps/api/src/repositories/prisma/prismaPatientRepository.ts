import { AUDIT_PATIENT_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { fullName, patientNameSelect } from './patientName';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';
import { latestRevision, recordRevision, Rollback, unlessRolledBack } from './recordRevision';
import { patientSnapshot } from './clinicalSnapshots';
import type {
  PatientCreateInput,
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
    birthDate: row.birthDate?.toISOString() ?? null,
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
  ): Promise<PatientRecordDTO> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
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
      return { ...patient, version: 1 };
    });
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
    );
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
};
