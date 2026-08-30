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
  lastActivityAt(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<Date | null>;
}
