import { prisma } from '../../lib/prisma';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  BodyRegionDTO,
  MuscularChainDTO,
  SessionTechniqueCreateDTO,
  SessionTechniqueDTO,
  SessionTechniqueRepository,
} from '../sessionTechniqueRepository';

const techniqueEntrySelect = {
  id: true,
  sessionId: true,
  techniqueId: true,
  bodyRegionId: true,
  muscularChainId: true,
  variantNotes: true,
  createdAt: true,
  technique: { select: { name: true } },
  bodyRegion: { select: { name: true } },
  muscularChain: { select: { name: true } },
} as const;

function toDTO(
  row: {
    id: string;
    sessionId: string;
    techniqueId: string;
    bodyRegionId: string | null;
    muscularChainId: string | null;
    variantNotes: string | null;
    createdAt: Date;
    technique: { name: string };
    bodyRegion: { name: string } | null;
    muscularChain: { name: string } | null;
  },
): SessionTechniqueDTO {
  return {
    id: row.id,
    sessionId: row.sessionId,
    techniqueId: row.techniqueId,
    techniqueName: row.technique.name,
    bodyRegionId: row.bodyRegionId,
    bodyRegionName: row.bodyRegion?.name ?? null,
    muscularChainId: row.muscularChainId,
    muscularChainName: row.muscularChain?.name ?? null,
    variantNotes: row.variantNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaSessionTechniqueRepository: SessionTechniqueRepository = {
  // Los catálogos son globales (sin tenantId en el schema): van por el cliente
  // base a propósito — pedir un ctx acá mentiría una dependencia de tenant
  // que no existe.
  async listBodyRegions(): Promise<BodyRegionDTO[]> {
    const rows = await prisma.bodyRegion.findMany({
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, zone: true },
    });
    return rows;
  },

  async listMuscularChains(): Promise<MuscularChainDTO[]> {
    const rows = await prisma.muscularChain.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    });
    return rows;
  },

  async listBySession(
    ctx: TenantContext,
    patientId: string,
    sessionId: string,
  ): Promise<SessionTechniqueDTO[]> {
    const db = forTenant(ctx);
    // La sesión debe ser del tenant y del paciente: el tenantId lo inyecta
    // el guard, acá solo va el patientId.
    const session = await db.session.findFirst({
      where: { id: sessionId, patientId },
      select: { id: true },
    });
    if (!session) return [];

    const rows = await db.sessionTechnique.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: techniqueEntrySelect,
    });

    return rows.map(toDTO);
  },

  async bulkReplace(
    ctx: TenantContext,
    patientId: string,
    sessionId: string,
    entries: SessionTechniqueCreateDTO[],
  ): Promise<SessionTechniqueDTO[] | null> {
    const db = forTenant(ctx);
    // La sesión debe ser del tenant y del paciente (tenantId vía guard).
    // null y no throw: la convención del repo es que "no encontrado" es un
    // valor, no una excepción — la ruta lo mapea a 404 (antes el throw
    // genérico terminaba en un 500 del errorHandler).
    const session = await db.session.findFirst({
      where: { id: sessionId, patientId },
      select: { id: true },
    });
    if (!session) return null;

    // Delete existing + create new in a transaction
    await db.$transaction([
      db.sessionTechnique.deleteMany({ where: { sessionId } }),
      ...entries.map((e) =>
        db.sessionTechnique.create({
          data: {
            sessionId,
            techniqueId: e.techniqueId,
            bodyRegionId: e.bodyRegionId ?? null,
            muscularChainId: e.muscularChainId ?? null,
            variantNotes: e.variantNotes ?? null,
          },
        }),
      ),
    ]);

    // Re-fetch with joins
    const rows = await db.sessionTechnique.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: techniqueEntrySelect,
    });

    return rows.map(toDTO);
  },
};
