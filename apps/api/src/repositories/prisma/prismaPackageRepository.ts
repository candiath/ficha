import { forTenant } from '../../lib/tenantScope';
import { fullName, patientNameSelect } from './patientName';
import { recordAudit } from './recordAudit';
import type { AuditBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import type { PackageCreateInput, PackageDTO, PackageRepository } from '../packageRepository';

// tenantId y updatedAt quedan afuera; el count de pagos alimenta
// usedSessions/remainingSessions del DTO.
const packageSelect = {
  id: true,
  patientId: true,
  name: true,
  totalSessions: true,
  pricePerSessionCents: true,
  notes: true,
  createdAt: true,
  patient: { select: patientNameSelect },
  _count: { select: { payments: true } },
} as const;

type PackageRow = {
  id: string;
  patientId: string;
  name: string;
  totalSessions: number;
  pricePerSessionCents: bigint;
  notes: string | null;
  createdAt: Date;
  patient: { firstName: string; lastName: string };
  _count: { payments: number };
};

function toDTO(row: PackageRow): PackageDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: fullName(row.patient),
    name: row.name,
    totalSessions: row.totalSessions,
    pricePerSessionCents: Number(row.pricePerSessionCents),
    usedSessions: row._count.payments,
    remainingSessions: row.totalSessions - row._count.payments,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaPackageRepository: PackageRepository = {
  async list(
    ctx: TenantContext,
    filters?: { patientId?: string },
  ): Promise<PackageDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.sessionPackage.findMany({
      where: {
        ...(filters?.patientId ? { patientId: filters.patientId } : {}),
      },
      select: packageSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDTO);
  },

  // Both writes record their audit row in the same transaction (#188).

  async create(
    ctx: TenantContext,
    input: PackageCreateInput,
    audit: AuditBuilder<PackageDTO>,
  ): Promise<PackageDTO> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      const row = await tx.sessionPackage.create({
        data: {
          tenantId: ctx.tenantId,
          patientId: input.patientId,
          name: input.name,
          totalSessions: input.totalSessions,
          pricePerSessionCents: input.pricePerSessionCents,
          notes: input.notes ?? null,
        },
        select: packageSelect,
      });
      const pkg = toDTO(row);
      await recordAudit(tx, ctx, audit(pkg));
      return pkg;
    });
  },

  async deleteIfUnused(
    ctx: TenantContext,
    id: string,
    audit: AuditBuilder<{ id: string; patientId: string }>,
  ): Promise<'deleted' | 'not_found' | 'in_use'> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // A package never changes patient, so reading it first opens no window:
      // the audit row needs its patient, and the row will be gone after the
      // delete. Not finding it also tells "no existe" from "tiene pagos".
      const found = await tx.sessionPackage.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true, patientId: true },
      });
      if (!found) return 'not_found';

      // La condición "sin pagos" viaja en el where del delete: no hay ventana
      // en la que un pago nuevo debite el paquete entre chequeo y borrado.
      const { count } = await tx.sessionPackage.deleteMany({
        where: { id, tenantId: ctx.tenantId, payments: { none: {} } },
      });
      if (count === 0) return 'in_use';

      await recordAudit(tx, ctx, audit(found));
      return 'deleted';
    });
  },

  async belongsToPatient(
    ctx: TenantContext,
    packageId: string,
    patientId: string,
  ): Promise<boolean> {
    const db = forTenant(ctx);
    const row = await db.sessionPackage.findFirst({
      where: { id: packageId, patientId },
      select: { id: true },
    });
    return row !== null;
  },
};
