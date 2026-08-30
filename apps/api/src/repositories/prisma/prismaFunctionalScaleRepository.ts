import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  FunctionalScaleCreateInput,
  FunctionalScaleDTO,
  FunctionalScaleRepository,
  FunctionalScaleSummaryDTO,
} from '../functionalScaleRepository';

const summarySelect = {
  id: true,
  scaleType: true,
  score: true,
  interpretation: true,
  appliedAt: true,
  createdAt: true,
} as const;

// tenantId queda afuera a propósito: antes el GET de detalle devolvía la fila
// cruda entera y lo filtraba de más.
const detailSelect = {
  ...summarySelect,
  patientId: true,
  episodeId: true,
  responses: true,
} as const;

type SummaryRow = Omit<FunctionalScaleSummaryDTO, 'appliedAt' | 'createdAt'> & {
  appliedAt: Date;
  createdAt: Date;
};

type DetailRow = SummaryRow & {
  patientId: string;
  episodeId: string | null;
  responses: unknown;
};

function toSummaryDTO(row: SummaryRow): FunctionalScaleSummaryDTO {
  return {
    ...row,
    appliedAt: row.appliedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toDTO(row: DetailRow): FunctionalScaleDTO {
  return {
    ...row,
    appliedAt: row.appliedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaFunctionalScaleRepository: FunctionalScaleRepository = {
  async listByPatient(
    ctx: TenantContext,
    patientId: string,
  ): Promise<FunctionalScaleSummaryDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.functionalScale.findMany({
      where: { patientId },
      orderBy: { appliedAt: 'desc' },
      select: summarySelect,
    });
    return rows.map(toSummaryDTO);
  },

  async getById(
    ctx: TenantContext,
    patientId: string,
    id: string,
  ): Promise<FunctionalScaleDTO | null> {
    const db = forTenant(ctx);
    const row = await db.functionalScale.findFirst({
      where: { id, patientId },
      select: detailSelect,
    });
    return row ? toDTO(row) : null;
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: FunctionalScaleCreateInput,
  ): Promise<FunctionalScaleDTO> {
    const db = forTenant(ctx);
    const row = await db.functionalScale.create({
      data: {
        patientId,
        scaleType: input.scaleType,
        responses: input.responses,
        score: input.score,
        interpretation: input.interpretation,
        ...(input.appliedAt ? { appliedAt: input.appliedAt } : {}),
      },
      select: detailSelect,
    });
    return toDTO(row);
  },

  async delete(ctx: TenantContext, patientId: string, id: string): Promise<boolean> {
    const db = forTenant(ctx);
    // deleteMany y no delete: existencia y pertenencia en la misma query que
    // borra (antes el delete iba con where { id } pelado tras un findFirst).
    const { count } = await db.functionalScale.deleteMany({
      where: { id, patientId },
    });
    return count > 0;
  },
};
