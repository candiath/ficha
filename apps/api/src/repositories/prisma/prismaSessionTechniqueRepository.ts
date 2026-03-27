import { prisma } from '../../lib/prisma';
import type { TenantContext } from '../types';
import type {
  BodyRegionDTO,
  SessionTechniqueCreateDTO,
  SessionTechniqueDTO,
  SessionTechniqueRepository,
} from '../sessionTechniqueRepository';

const techniqueEntrySelect = {
  id: true,
  sessionId: true,
  techniqueId: true,
  bodyRegionId: true,
  variantNotes: true,
  createdAt: true,
  technique: { select: { name: true } },
  bodyRegion: { select: { name: true } },
} as const;

function toDTO(
  row: {
    id: string;
    sessionId: string;
    techniqueId: string;
    bodyRegionId: string | null;
    variantNotes: string | null;
    createdAt: Date;
    technique: { name: string };
    bodyRegion: { name: string } | null;
  },
): SessionTechniqueDTO {
  return {
    id: row.id,
    sessionId: row.sessionId,
    techniqueId: row.techniqueId,
    techniqueName: row.technique.name,
    bodyRegionId: row.bodyRegionId,
    bodyRegionName: row.bodyRegion?.name ?? null,
    variantNotes: row.variantNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaSessionTechniqueRepository: SessionTechniqueRepository = {
  async listBodyRegions(): Promise<BodyRegionDTO[]> {
    const rows = await prisma.bodyRegion.findMany({
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, zone: true },
    });
    return rows;
  },

  async listBySession(
    ctx: TenantContext,
    patientId: string,
    sessionId: string,
  ): Promise<SessionTechniqueDTO[]> {
    // Validate session belongs to tenant + patient
    const session = await prisma.session.findFirst({
      where: { id: sessionId, patientId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!session) return [];

    const rows = await prisma.sessionTechnique.findMany({
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
  ): Promise<SessionTechniqueDTO[]> {
    // Validate session belongs to tenant + patient
    const session = await prisma.session.findFirst({
      where: { id: sessionId, patientId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!session) throw new Error('Sesión no encontrada');

    // Delete existing + create new in a transaction
    await prisma.$transaction([
      prisma.sessionTechnique.deleteMany({ where: { sessionId } }),
      ...entries.map((e) =>
        prisma.sessionTechnique.create({
          data: {
            sessionId,
            techniqueId: e.techniqueId,
            bodyRegionId: e.bodyRegionId ?? null,
            variantNotes: e.variantNotes ?? null,
          },
        }),
      ),
    ]);

    // Re-fetch with joins
    const rows = await prisma.sessionTechnique.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: techniqueEntrySelect,
    });

    return rows.map(toDTO);
  },
};
