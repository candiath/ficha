import type { EpisodeStatus } from '@prisma/client';
import type { AUDIT_EPISODE_FIELDS } from '@ficha/shared';
import type { AuditBuilder, AuditEntry } from './auditLogRepository';
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

// Resultado discriminado (convención del repo, misma forma que
// PaymentUpdateResult): existe y se escribió, no existe, existe pero la fecha
// de cierre es anterior a la apertura, o el pedido cambia el estado y corrige
// el motivo a la vez.
export type EpisodeUpdateResult =
  | { ok: true; episode: EpisodeDTO }
  | { ok: false; reason: 'not_found' | 'closed_before_opened' | 'transition_with_correction' };

export type EpisodeAuditField = keyof typeof AUDIT_EPISODE_FIELDS;

// What an update did, decided against the stored row (SPEC-clinical-revisions.md
// §4): a change of status is a fact of its own, closing or reopening the
// episode, and anything else is a correction of its data. One request never
// does both, so this is exactly one of them.
export type EpisodeChange =
  | { kind: 'closed'; status: Exclude<EpisodeStatus, 'ACTIVE'> }
  | { kind: 'reopened' }
  | { kind: 'corrected'; changedFields: [EpisodeAuditField, ...EpisodeAuditField[]] };

// The route turns the change into its audit entry. Not called when nothing
// changed: an update that changes nothing records nothing.
export type EpisodeUpdateAudit = (episode: EpisodeDTO, change: EpisodeChange) => AuditEntry;

// ─── Port ────────────────────────────────────────────────────────────────────

// Los episodios viven anidados bajo un paciente: todo método pide patientId
// además del ctx, y un episodio de otro paciente (aunque sea del tenant)
// cuenta como inexistente. La vigencia del PACIENTE no se chequea acá: eso
// es patientRepo.exists, y la ruta decide cuándo exigirla.
export interface EpisodeRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<EpisodeDTO[]>;
  /** true si el episodio existe y es del paciente (y del tenant). */
  exists(ctx: TenantContext, patientId: string, id: string): Promise<boolean>;
  /** Records its audit row in the same transaction (#188). */
  create(
    ctx: TenantContext,
    patientId: string,
    input: EpisodeCreateInput,
    audit: AuditBuilder<EpisodeDTO>,
  ): Promise<EpisodeDTO>;
  /**
   * `not_found` si el episodio no existe, es de otro paciente o de otro tenant;
   * `closed_before_opened` si la fecha de cierre que se quiere escribir es
   * anterior a la apertura guardada; `transition_with_correction` si cambia el
   * estado y también el motivo de consulta. Se decide con la fila bloqueada,
   * y en los dos últimos casos no se escribe nada.
   *
   * Records its audit row in the same transaction (#188), unless nothing changed.
   */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: EpisodeUpdateInput,
    audit: EpisodeUpdateAudit,
  ): Promise<EpisodeUpdateResult>;
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
