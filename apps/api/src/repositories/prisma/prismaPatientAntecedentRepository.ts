import { Prisma } from '@prisma/client';
import { AUDIT_PATIENT_ANTECEDENT_FIELDS, type PartialDate } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type { AuditBuilder, AuditUpdateBuilder } from '../auditLogRepository';
import type {
  PatientAntecedentAuditField,
  PatientAntecedentDTO,
  PatientAntecedentEditMeta,
  PatientAntecedentInput,
  PatientAntecedentUpdateResult,
  PatientAntecedentRepository,
} from '../patientAntecedentRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';
import { recordRevision, Rollback, unlessRolledBack } from './recordRevision';
import { patientAntecedentSnapshot } from './clinicalSnapshots';

// Every method works on current antecedents: an annulled one is not edited, and
// only the patient's record (listByPatient) lists it, struck through, as with
// encounters (SPEC-clinical-revisions.md §8). deletedAt is the annulment's date.
const CURRENT = { deletedAt: null } as const;

const antecedentSelect = {
  id: true,
  patientId: true,
  kind: true,
  description: true,
  occurredOn: true,
  occurredPrecision: true,
  occurredApproximate: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  // The latest version; none is version 0.
  revisions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} as const;

type AntecedentRow = Prisma.PatientAntecedentGetPayload<{ select: typeof antecedentSelect }>;

const AUDIT_FIELDS = Object.keys(AUDIT_PATIENT_ANTECEDENT_FIELDS) as PatientAntecedentAuditField[];

function toDTO({ occurredOn, occurredPrecision, occurredApproximate, revisions, deletedAt, ...row }: AntecedentRow): PatientAntecedentDTO {
  return {
    ...row,
    version: revisions[0]?.version ?? 0,
    occurred:
      occurredOn && occurredPrecision
        ? { date: occurredOn.toISOString().slice(0, 10), precision: occurredPrecision, approximate: occurredApproximate }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    annulledAt: deletedAt?.toISOString() ?? null,
  };
}

// The three date columns from the partial date: all of them, always, so the
// database's CHECKs see a consistent set.
function occurredColumns(occurred: PartialDate | null) {
  return occurred
    ? {
        occurredOn: new Date(`${occurred.date}T00:00:00.000Z`),
        occurredPrecision: occurred.precision,
        occurredApproximate: occurred.approximate,
      }
    : { occurredOn: null, occurredPrecision: null, occurredApproximate: false };
}

function antecedentData(input: Partial<PatientAntecedentInput>) {
  return {
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.occurred !== undefined && occurredColumns(input.occurred)),
  };
}

export const prismaPatientAntecedentRepository: PatientAntecedentRepository = {
  async listByPatient(ctx: TenantContext, patientId: string): Promise<PatientAntecedentDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.patientAntecedent.findMany({
      // Annulled ones included: the record shows them, struck through.
      where: { patientId },
      // What she lived, newest first; what she cannot date, at the end.
      orderBy: [{ occurredOn: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: antecedentSelect,
    });
    return rows.map(toDTO);
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: PatientAntecedentInput,
    audit: AuditBuilder<PatientAntecedentDTO>,
  ): Promise<PatientAntecedentDTO> {
    const db = forTenant(ctx);
    // The audit row goes in the same transaction as the write (#188).
    return db.$transaction(async (tx) => {
      const row = await tx.patientAntecedent.create({
        data: { ...antecedentData(input), kind: input.kind, description: input.description, tenantId: ctx.tenantId, patientId },
        select: antecedentSelect,
      });
      const antecedent = { ...toDTO(row), version: 1 };
      const auditLogId = await recordAudit(tx, ctx, audit(antecedent));
      await recordRevision(tx, ctx, 'patient_antecedent_revisions', {
        aggregateId: row.id,
        patientId,
        version: 1,
        auditLogId,
        snapshot: patientAntecedentSnapshot(row),
      });
      return antecedent;
    });
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    { expectedVersion, reasonNote, ...input }: Partial<PatientAntecedentInput> & PatientAntecedentEditMeta,
    audit: AuditUpdateBuilder<PatientAntecedentDTO, PatientAntecedentAuditField>,
  ): Promise<PatientAntecedentUpdateResult> {
    const db = forTenant(ctx);
    const notFound = { ok: false, reason: 'not_found' } as const;
    try {
      return await unlessRolledBack(
        db.$transaction(async (tx): Promise<PatientAntecedentUpdateResult> => {
          // Locked and read first: a concurrent edit waits for this one, and
          // then reads the version this one wrote.
          await lockRow(tx, 'patient_antecedents', id, ctx.tenantId);
          const beforeRow = await tx.patientAntecedent.findFirst({
            where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
            select: antecedentSelect,
          });
          if (!beforeRow) return notFound;
          const before = toDTO(beforeRow);
          if (expectedVersion !== undefined && expectedVersion !== before.version) return { ok: false, reason: 'stale' };

          // Patient, tenant and validity in the where of the write itself: P2025
          // when it no longer matches, which becomes not_found below.
          const row = await tx.patientAntecedent.update({
            where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
            data: antecedentData(input),
            select: antecedentSelect,
          });
          const antecedent = { ...toDTO(row), version: before.version + 1 };
          // Compared after the write, with the same select: a save that changed
          // nothing is rolled back whole.
          const changed = nonEmpty(changedFields(before, antecedent, AUDIT_FIELDS));
          if (!changed) throw new Rollback<PatientAntecedentUpdateResult>({ ok: true, antecedent: before });
          const auditLogId = await recordAudit(tx, ctx, audit(antecedent, changed));
          await recordRevision(tx, ctx, 'patient_antecedent_revisions', {
            aggregateId: id,
            patientId,
            version: antecedent.version,
            auditLogId,
            snapshot: patientAntecedentSnapshot(row),
            reasonNote,
          });
          return { ok: true, antecedent };
        }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return notFound;
      throw e;
    }
  },

  async annul(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: { reasonNote?: string | null },
    audit: AuditBuilder<PatientAntecedentDTO>,
  ): Promise<'annulled' | 'not_found'> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // Locked first: this write takes a version, so it waits for a concurrent
      // edit and then reads the version that edit wrote.
      await lockRow(tx, 'patient_antecedents', id, ctx.tenantId);
      // The condition travels in the write: an annulled antecedent, or another
      // patient's, matches nothing.
      const { count } = await tx.patientAntecedent.updateMany({
        where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return 'not_found';
      // The final version, of unchanged content: the annulment is what its
      // audit row says, and the note goes only into the revision.
      const row = await tx.patientAntecedent.findUniqueOrThrow({
        where: { id, tenantId: ctx.tenantId },
        select: antecedentSelect,
      });
      const antecedent = { ...toDTO(row), version: (row.revisions[0]?.version ?? 0) + 1 };
      const auditLogId = await recordAudit(tx, ctx, audit(antecedent));
      await recordRevision(tx, ctx, 'patient_antecedent_revisions', {
        aggregateId: id,
        patientId,
        version: antecedent.version,
        auditLogId,
        snapshot: patientAntecedentSnapshot(row),
        reasonNote: input.reasonNote,
      });
      return 'annulled';
    });
  },
};
