import { AUDIT_EPISODE_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { AuditBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import type {
  EpisodeAuditField,
  EpisodeChange,
  EpisodeCreateInput,
  EpisodeDTO,
  EpisodeRepository,
  EpisodeUpdateAudit,
  EpisodeUpdateInput,
  EpisodeUpdateResult,
  StaleEpisodeDTO,
} from '../episodeRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';

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

const AUDIT_FIELDS = Object.keys(AUDIT_EPISODE_FIELDS) as EpisodeAuditField[];

function toDTO(row: EpisodeRow): EpisodeDTO {
  return {
    ...row,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// What the write did, from the row before and after it: a new status closes or
// reopens the episode (its closing date goes with it), anything else is a
// correction. null when nothing changed.
function changeOf(before: EpisodeDTO, after: EpisodeDTO): EpisodeChange | null {
  if (after.status !== before.status) {
    return after.status === 'ACTIVE' ? { kind: 'reopened' } : { kind: 'closed', status: after.status };
  }
  const changed = nonEmpty(changedFields(before, after, AUDIT_FIELDS));
  return changed ? { kind: 'corrected', changedFields: changed } : null;
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

  // Both writes record their audit row in the same transaction (#188).

  async create(
    ctx: TenantContext,
    patientId: string,
    input: EpisodeCreateInput,
    audit: AuditBuilder<EpisodeDTO>,
  ): Promise<EpisodeDTO> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      const row = await tx.clinicalEpisode.create({
        data: {
          tenantId: ctx.tenantId,
          patientId,
          mainComplaint: input.mainComplaint,
          ...(input.openedAt ? { openedAt: input.openedAt } : {}),
        },
        select: episodeSelect,
      });
      const episode = toDTO(row);
      await recordAudit(tx, ctx, audit(episode));
      return episode;
    });
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: EpisodeUpdateInput,
    audit: EpisodeUpdateAudit,
  ): Promise<EpisodeUpdateResult> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx): Promise<EpisodeUpdateResult> => {
      // Locked and read first: what the request does (close, reopen or
      // correct) is decided against the stored row, and a concurrent edit
      // waits for this one.
      await lockRow(tx, 'clinical_episodes', id, ctx.tenantId);
      const found = await tx.clinicalEpisode.findFirst({
        where: { id, patientId, tenantId: ctx.tenantId },
        select: episodeSelect,
      });
      // Inexistente, de otro paciente o de otro tenant: lo mismo.
      if (!found) return { ok: false, reason: 'not_found' };
      const before = toDTO(found);

      // One write, one fact: a status change that also corrects the complaint
      // would be two, under one audit row that could only name one.
      const transition = input.status !== undefined && input.status !== before.status;
      if (transition && input.mainComplaint !== undefined && input.mainComplaint !== before.mainComplaint) {
        return { ok: false, reason: 'transition_with_correction' };
      }

      // La coherencia de las fechas va en el where del write: un episodio no
      // puede cerrarse antes de abrirse, y openedAt vive en la base. Con la
      // fila bloqueada y encontrada, no escribir solo puede ser eso, o un
      // pedido sin campos: Prisma no escribe nada y cuenta 0.
      const { count } = await tx.clinicalEpisode.updateMany({
        where: {
          id,
          patientId,
          tenantId: ctx.tenantId,
          ...(input.closedAt ? { openedAt: { lte: input.closedAt } } : {}),
        },
        data: input,
      });
      if (count === 0 && input.closedAt) return { ok: false, reason: 'closed_before_opened' };

      const row = await tx.clinicalEpisode.findFirstOrThrow({
        where: { id, tenantId: ctx.tenantId },
        select: episodeSelect,
      });
      const episode = toDTO(row);
      const change = changeOf(before, episode);
      if (change) await recordAudit(tx, ctx, audit(episode, change));
      return { ok: true, episode };
    });
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

  async listStale(ctx: TenantContext, cutoff: Date): Promise<StaleEpisodeDTO[]> {
    const db = forTenant(ctx);

    // Se traen los episodios abiertos con la fecha de su última sesión, y el
    // filtro por antigüedad se hace acá: Prisma no sabe ordenar por un campo
    // de una relación anidada dentro de un where. El volumen por clínica
    // (episodios abiertos de un consultorio) hace que sea barato, mismo
    // criterio que la agregación por mes del dashboard (issue #64).
    const rows = await db.clinicalEpisode.findMany({
      where: {
        status: 'ACTIVE',
        // Un paciente borrado no puede recibir seguimiento: la alerta pediría
        // una acción imposible. Mismo criterio que el listado de alertas.
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        patientId: true,
        sessions: {
          where: { session: { deletedAt: null } },
          orderBy: { session: { sessionDate: 'desc' } },
          take: 1,
          select: { session: { select: { sessionDate: true } } },
        },
      },
    });

    return rows
      .map((row) => ({
        patientId: row.patientId,
        episodeId: row.id,
        lastActivityAt: row.sessions[0]?.session.sessionDate ?? null,
      }))
      .filter((e) => e.lastActivityAt === null || e.lastActivityAt < cutoff)
      .map((e) => ({ ...e, lastActivityAt: e.lastActivityAt?.toISOString() ?? null }));
  },

  async lastActivityAt(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<Date | null> {
    const db = forTenant(ctx);
    const lastSession = await db.session.findFirst({
      // deletedAt: null — una sesión borrada no cuenta como actividad, o el
      // episodio parecería vivo por algo que se dio de baja.
      where: { deletedAt: null, patientId, episodes: { some: { episodeId } } },
      orderBy: { sessionDate: 'desc' },
      select: { sessionDate: true },
    });
    return lastSession?.sessionDate ?? null;
  },
};
