import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  EpisodeCreateInput,
  EpisodeDTO,
  EpisodeRepository,
  EpisodeUpdateInput,
} from '../episodeRepository';

const episodeSelect = {
  id: true,
  patientId: true,
  status: true,
  mainComplaint: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type EpisodeRow = {
  id: string;
  patientId: string;
  status: EpisodeDTO['status'];
  mainComplaint: string | null;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDTO(row: EpisodeRow): EpisodeDTO {
  return {
    ...row,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const prismaEpisodeRepository: EpisodeRepository = {
  async listByPatient(ctx: TenantContext, patientId: string): Promise<EpisodeDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.clinicalEpisode.findMany({
      where: { patientId },
      orderBy: { openedAt: 'desc' },
      select: episodeSelect,
    });
    return rows.map(toDTO);
  },

  async exists(ctx: TenantContext, patientId: string, id: string): Promise<boolean> {
    const db = forTenant(ctx);
    const row = await db.clinicalEpisode.findFirst({
      where: { id, patientId },
      select: { id: true },
    });
    return row !== null;
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: EpisodeCreateInput,
  ): Promise<EpisodeDTO> {
    const db = forTenant(ctx);
    const row = await db.clinicalEpisode.create({
      data: {
        patientId,
        mainComplaint: input.mainComplaint,
        ...(input.openedAt ? { openedAt: input.openedAt } : {}),
      },
      select: episodeSelect,
    });
    return toDTO(row);
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: EpisodeUpdateInput,
  ): Promise<EpisodeDTO | null> {
    const db = forTenant(ctx);
    // updateMany y no update: existencia, pertenencia al paciente y al tenant
    // se deciden en la misma query que escribe (patrón de patientRepo.update).
    const { count } = await db.clinicalEpisode.updateMany({
      where: { id, patientId },
      data: input,
    });
    if (count === 0) return null;

    const row = await db.clinicalEpisode.findFirst({
      where: { id, patientId },
      select: episodeSelect,
    });
    return row ? toDTO(row) : null;
  },

  async allBelongToPatient(
    ctx: TenantContext,
    patientId: string,
    episodeIds: string[],
  ): Promise<boolean> {
    if (episodeIds.length === 0) return true;
    // Deduplicar antes de contar: con ids repetidos count devolvería menos que
    // length y un request válido se rechazaría por error.
    const uniqueIds = [...new Set(episodeIds)];
    const db = forTenant(ctx);
    // patientId garantiza el dueño; la extension agrega el tenantId como
    // defensa en profundidad.
    const found = await db.clinicalEpisode.count({
      where: { id: { in: uniqueIds }, patientId },
    });
    return found === uniqueIds.length;
  },

  async lastActivityAt(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<Date | null> {
    const db = forTenant(ctx);
    const lastSession = await db.session.findFirst({
      where: { patientId, episodes: { some: { episodeId } } },
      orderBy: { sessionDate: 'desc' },
      select: { sessionDate: true },
    });
    return lastSession?.sessionDate ?? null;
  },
};
