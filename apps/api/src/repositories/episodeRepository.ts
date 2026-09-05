import type { EpisodeStatus } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface EpisodeDTO {
  id: string;
  patientId: string;
  status: EpisodeStatus;
  mainComplaint: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Un episodio abierto de la clínica, con cuándo fue su última sesión. Lo
// consume el motor de alertas, que necesita mirar TODOS los episodios y no
// los de un paciente: la regla de inactividad corría al abrir la ficha, así
// que el paciente que nadie miraba nunca generaba alerta.
export interface StaleEpisodeDTO {
  patientId: string;
  episodeId: string;
  mainComplaint: string | null;
  /** null si el episodio nunca tuvo una sesión. */
  lastActivityAt: string | null;
}

// Fechas como Date: la conversión desde el string ISO del body es de la ruta.
export interface EpisodeCreateInput {
  mainComplaint?: string | null;
  openedAt?: Date;
}

export interface EpisodeUpdateInput {
  status?: EpisodeStatus;
  mainComplaint?: string | null;
  closedAt?: Date | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Los episodios viven anidados bajo un paciente: todo método pide patientId
// además del ctx, y un episodio de otro paciente (aunque sea del tenant)
// cuenta como inexistente. La vigencia del PACIENTE no se chequea acá: eso
// es patientRepo.exists, y la ruta decide cuándo exigirla.
export interface EpisodeRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<EpisodeDTO[]>;
  /** true si el episodio existe y es del paciente (y del tenant). */
  exists(ctx: TenantContext, patientId: string, id: string): Promise<boolean>;
  create(ctx: TenantContext, patientId: string, input: EpisodeCreateInput): Promise<EpisodeDTO>;
  /** null si el episodio no existe, es de otro paciente o de otro tenant. */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: EpisodeUpdateInput,
  ): Promise<EpisodeDTO | null>;
  /** true si TODOS los ids son episodios del paciente (dedupe interno). */
  allBelongToPatient(
    ctx: TenantContext,
    patientId: string,
    episodeIds: string[],
  ): Promise<boolean>;
  /** Fecha de la última sesión que abordó el episodio; null si nunca tuvo. */
  /**
   * Episodios ACTIVE de la clínica cuya última sesión es anterior a `cutoff`,
   * junto con los que nunca tuvieron ninguna.
   *
   * Devuelve también los que no tienen sesiones para que quien llama decida:
   * la regla de inactividad los ignora (un episodio recién abierto no es un
   * tratamiento abandonado), pero esa decisión es política y no persistencia.
   */
  listStale(ctx: TenantContext, cutoff: Date): Promise<StaleEpisodeDTO[]>;
  lastActivityAt(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<Date | null>;
}
