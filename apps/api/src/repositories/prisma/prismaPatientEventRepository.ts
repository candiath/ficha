import { Prisma } from '@prisma/client';
import { AUDIT_PATIENT_EVENT_FIELDS, type PartialDate } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../auditLogRepository';
import type {
  PatientEventAuditField,
  PatientEventDTO,
  PatientEventInput,
  PatientEventRepository,
} from '../patientEventRepository';
import { changedFields, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';

// Every method works on current events: one deleted is not listed, read or
// edited, as with sessions.
const CURRENT = { deletedAt: null } as const;

const eventSelect = {
  id: true,
  patientId: true,
  kind: true,
  description: true,
  occurredOn: true,
  occurredPrecision: true,
  occurredApproximate: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EventRow = Prisma.PatientEventGetPayload<{ select: typeof eventSelect }>;

const AUDIT_FIELDS = Object.keys(AUDIT_PATIENT_EVENT_FIELDS) as PatientEventAuditField[];

function toDTO({ occurredOn, occurredPrecision, occurredApproximate, ...row }: EventRow): PatientEventDTO {
  return {
    ...row,
    occurred:
      occurredOn && occurredPrecision
        ? { date: occurredOn.toISOString().slice(0, 10), precision: occurredPrecision, approximate: occurredApproximate }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

function eventData(input: Partial<PatientEventInput>) {
  return {
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.occurred !== undefined && occurredColumns(input.occurred)),
  };
}

export const prismaPatientEventRepository: PatientEventRepository = {
  async listByPatient(ctx: TenantContext, patientId: string): Promise<PatientEventDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.patientEvent.findMany({
      where: { ...CURRENT, patientId },
      // What she lived, newest first; what she cannot date, at the end.
      orderBy: [{ occurredOn: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: eventSelect,
    });
    return rows.map(toDTO);
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: PatientEventInput,
    audit: AuditBuilder<PatientEventDTO>,
  ): Promise<PatientEventDTO> {
    const db = forTenant(ctx);
    // The audit row goes in the same transaction as the write (#188).
    return db.$transaction(async (tx) => {
      const row = await tx.patientEvent.create({
        data: { ...eventData(input), kind: input.kind, description: input.description, tenantId: ctx.tenantId, patientId },
        select: eventSelect,
      });
      const event = toDTO(row);
      await recordAudit(tx, ctx, audit(event));
      return event;
    });
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: Partial<PatientEventInput>,
    audit: AuditUpdateBuilder<PatientEventDTO, PatientEventAuditField>,
  ): Promise<PatientEventDTO | null> {
    const db = forTenant(ctx);
    try {
      return await db.$transaction(async (tx) => {
        const before = await tx.patientEvent.findFirst({
          where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
          select: eventSelect,
        });
        if (!before) return null;

        // Patient, tenant and validity in the where of the write itself: P2025
        // when it no longer matches, which becomes null below.
        const row = await tx.patientEvent.update({
          where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
          data: eventData(input),
          select: eventSelect,
        });
        const event = toDTO(row);
        const changed = nonEmpty(changedFields(toDTO(before), event, AUDIT_FIELDS));
        if (changed) await recordAudit(tx, ctx, audit(event, changed));
        return event;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return null;
      throw e;
    }
  },

  async softDelete(
    ctx: TenantContext,
    patientId: string,
    id: string,
    audit: (deleted: PatientEventDTO) => AuditEntry,
  ): Promise<'deleted' | 'not_found'> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      const row = await tx.patientEvent.findFirst({
        where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
        select: eventSelect,
      });
      if (!row) return 'not_found';
      // The condition travels in the write: a concurrent delete matches nothing.
      const { count } = await tx.patientEvent.updateMany({
        where: { ...CURRENT, id, patientId, tenantId: ctx.tenantId },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return 'not_found';
      await recordAudit(tx, ctx, audit(toDTO(row)));
      return 'deleted';
    });
  },
};
