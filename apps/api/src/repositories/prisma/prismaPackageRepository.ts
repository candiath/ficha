import { forTenant } from '../../lib/tenantScope';
import { fullName, patientNameSelect } from './patientName';
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

  async create(ctx: TenantContext, input: PackageCreateInput): Promise<PackageDTO> {
    const db = forTenant(ctx);
    const row = await db.sessionPackage.create({
      data: {
        patientId: input.patientId,
        name: input.name,
        totalSessions: input.totalSessions,
        pricePerSessionCents: input.pricePerSessionCents,
        notes: input.notes ?? null,
      },
      select: packageSelect,
    });
    return toDTO(row);
  },

  async deleteIfUnused(
    ctx: TenantContext,
    id: string,
  ): Promise<'deleted' | 'not_found' | 'in_use'> {
    const db = forTenant(ctx);
    // La condición "sin pagos" viaja en el where del delete: no hay ventana
    // en la que un pago nuevo debite el paquete entre chequeo y borrado.
    const { count } = await db.sessionPackage.deleteMany({
      where: { id, payments: { none: {} } },
    });
    if (count > 0) return 'deleted';

    // count 0: distinguir "no existe" de "tiene pagos" solo para el mensaje.
    const exists = await db.sessionPackage.findFirst({
      where: { id },
      select: { id: true },
    });
    return exists ? 'in_use' : 'not_found';
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
