import { prisma } from '../../lib/prisma';
import type { TenantContext } from '../types';
import type { TechniqueDTO, TechniqueRepository } from '../techniqueRepository';

// Technique NO está en TENANT_SCOPED_MODELS (tenantId nullable: el catálogo
// global convive con las propias), así que el guard de forTenant no inyecta
// nada. Se usa el prisma base a propósito: pasar por forTenant aparentaría
// una protección que no aplica a este modelo, y acá cada where lleva el
// filtro de tenant a mano.

const techniqueSelect = {
  id: true,
  name: true,
  isGlobal: true,
  tenantId: true,
  createdAt: true,
} as const;

// Utilizable = global o del tenant. Único lugar donde vive el predicado.
// Antes convivían dos versiones (isGlobal: true en la ruta, tenantId: null
// en lib/techniques.ts) que solo coincidían porque el seed crea las globales
// con ambas marcas a la vez.
function usableWhere(tenantId: string) {
  return { OR: [{ isGlobal: true }, { tenantId }] };
}

type TechniqueRow = {
  id: string;
  name: string;
  isGlobal: boolean;
  tenantId: string | null;
  createdAt: Date;
};

function toDTO(row: TechniqueRow): TechniqueDTO {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export const prismaTechniqueRepository: TechniqueRepository = {
  async list(ctx: TenantContext): Promise<TechniqueDTO[]> {
    const rows = await prisma.technique.findMany({
      where: usableWhere(ctx.tenantId),
      orderBy: [{ isGlobal: 'desc' }, { name: 'asc' }],
      select: techniqueSelect,
    });
    return rows.map(toDTO);
  },

  async create(ctx: TenantContext, input: { name: string }): Promise<TechniqueDTO> {
    const row = await prisma.technique.create({
      data: { name: input.name, tenantId: ctx.tenantId, isGlobal: false },
      select: techniqueSelect,
    });
    return toDTO(row);
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: { name: string },
  ): Promise<TechniqueDTO | null> {
    // updateMany y no update: existencia, pertenencia y editabilidad se
    // deciden en la misma query que escribe (count 0 = nada que editar).
    // Antes el write iba con where { id } pelado después de un findFirst
    // que sí filtraba — la ventana clásica de check-then-write.
    const { count } = await prisma.technique.updateMany({
      where: { id, tenantId: ctx.tenantId, isGlobal: false },
      data: { name: input.name },
    });
    if (count === 0) return null;

    const row = await prisma.technique.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: techniqueSelect,
    });
    return row ? toDTO(row) : null;
  },

  async delete(ctx: TenantContext, id: string): Promise<boolean> {
    const { count } = await prisma.technique.deleteMany({
      where: { id, tenantId: ctx.tenantId, isGlobal: false },
    });
    return count > 0;
  },

  async allUsableByTenant(ctx: TenantContext, techniqueIds: string[]): Promise<boolean> {
    if (techniqueIds.length === 0) return true;
    // Deduplicar antes de contar: con ids repetidos el count daría de menos
    // y un request válido se rechazaría por error.
    const uniqueIds = [...new Set(techniqueIds)];
    const found = await prisma.technique.count({
      where: { id: { in: uniqueIds }, ...usableWhere(ctx.tenantId) },
    });
    return found === uniqueIds.length;
  },
};
