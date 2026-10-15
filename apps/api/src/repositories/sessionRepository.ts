import type { SessionType } from '@prisma/client';
import type { TenantContext } from './types';
import type { AUDIT_SESSION_FIELDS } from '@ficha/shared';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// One problem the session treated: its episode, and everything clinical about
// that problem (#238). A visit that treats the back and an ankle has two.
export interface SessionEpisodeBlockDTO {
  episodeId: string;
  preSessionState: string | null;
  treatment: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  patientExercises: string | null;
  reEvaluationNotes: string | null;
}

// The session holds the visit itself; `episodes`, one block per problem it
// treated, ordered by episode. `observations` is the text of a note.
export interface SessionDTO {
  id: string;
  patientId: string;
  sessionType: SessionType;
  sessionDate: string;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
  episodes: SessionEpisodeBlockDTO[];
}

// The clinic-wide index (GET /api/sessions): who and when, nothing clinical
// (#186, SPEC-list-minimization.md §1). A response that spans patients carries
// no clinical text; the session itself is read from the patient's routes.
export interface SessionIndexItemDTO {
  id: string;
  sessionType: SessionType;
  sessionDate: string;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
}

export interface SessionFields {
  sessionType: SessionType;
  sessionDate: Date;
  observations?: string | null;
}

// A block as written. A field that does not come is left as it was (a new
// block starts empty), the same rule as the session's own fields.
export interface SessionEpisodeBlockInput {
  episodeId: string;
  preSessionState?: string | null;
  treatment?: string | null;
  painScaleBefore?: number | null;
  painScaleAfter?: number | null;
  patientExercises?: string | null;
  reEvaluationNotes?: string | null;
}

export interface SessionPaymentInput {
  packageId?: string | null;
  baseAmount: number;
  discount: number;
  notes?: string | null;
}

// El POST crea la sesión con su cobro de una sola vez: antes el frontend
// encadenaba varios requests y un fallo intermedio dejaba sesiones sin pago
// (invisibles en Cobros).
export interface SessionCreateInput extends SessionFields {
  episodes: SessionEpisodeBlockInput[];
  payment?: SessionPaymentInput;
  /**
   * El turno del que salió esta sesión, si se registra desde la agenda.
   *
   * Va en la misma transacción que la sesión: vincular después, con un
   * segundo request, es lo que dejaba sesiones sin cobro antes de que el
   * POST aceptara el pago junto. La ruta valida que el turno sea de este
   * paciente; acá se exige además que no tenga ya una sesión.
   */
  appointmentId?: string | null;
}

// Which episodes a session may treat (#238): a session treats at least one, a
// discharge closes exactly one, and a note may stand alone.
export type SessionEpisodeRuleViolation = 'needs_episode' | 'discharge_needs_one_episode';

export type SessionCreateResult =
  | { ok: true; session: SessionDTO }
  // El turno ya produjo su sesión. Pasa si se aprieta dos veces "registrar
  // sesión" o si otra pestaña ganó de mano: la sesión NO se crea, para no
  // duplicar el registro clínico de una misma visita.
  | { ok: false; reason: 'appointment_taken' | SessionEpisodeRuleViolation };

export type SessionUpdateResult =
  | { ok: true; session: SessionDTO }
  // No current session of that patient with that id.
  | { ok: false; reason: 'not_found' | SessionEpisodeRuleViolation };

// payment queda afuera a propósito: el pago se edita por /api/payments.
// `episodes`, when it comes, is the whole set of blocks: a block left out is
// removed, a new one is added, and each kept one is updated field by field.
export type SessionUpdateInput = Partial<SessionFields> & { episodes?: SessionEpisodeBlockInput[] };

// ─── Port ────────────────────────────────────────────────────────────────────

// Como episodios y escalas: los métodos anidados piden patientId, y una
// sesión de otro paciente cuenta como inexistente. La vigencia del paciente
// la exige la ruta con patientRepo.exists; la pertenencia de episodios y
// paquete se valida antes con sus repos.
export type SessionAuditField = keyof typeof AUDIT_SESSION_FIELDS;

export interface SessionRepository {
  listByPatient(
    ctx: TenantContext,
    patientId: string,
    filters?: { episodeId?: string },
  ): Promise<SessionDTO[]>;
  /** null si la sesión no existe, es de otro paciente o de otro tenant. */
  getById(ctx: TenantContext, patientId: string, id: string): Promise<SessionDTO | null>;
  /** Every current session of the clinic, as an index: no clinical field. */
  listIndexForTenant(ctx: TenantContext): Promise<SessionIndexItemDTO[]>;
  /**
   * Crea sesión + cobro + cierre de episodios en una transacción: si algo
   * falla no queda una sesión a medias. La sesión se atribuye al usuario del
   * contexto.
   */
  create(
    ctx: TenantContext,
    patientId: string,
    input: SessionCreateInput,
    audit: AuditBuilder<SessionDTO>,
  ): Promise<SessionCreateResult>;
  /** null si no hay sesión vigente de ese paciente con ese id. */
  /**
   * Borrado lógico de una sesión cargada por error.
   *
   * - 'not_found': no existe, es de otro paciente/tenant, o ya estaba borrada.
   * - 'paid': tiene un cobro PAGADO. No se borra: plata que entró de verdad
   *   no se hace desaparecer desde acá. Primero hay que revertir el cobro.
   * - 'deleted': se marcó deletedAt y, si tenía un cobro PENDING o WAIVED,
   *   se eliminó — un cobro pendiente por una sesión que no existió no es
   *   historial, es trabajo pendiente sobre algo que no pasó. Si salió de un
   *   turno, el turno queda sin sessionId para poder registrarla de nuevo;
   *   su estado no cambia.
   */
  softDelete(
    ctx: TenantContext,
    patientId: string,
    id: string,
    audit: AuditEntry,
  ): Promise<'deleted' | 'not_found' | 'paid'>;
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: SessionUpdateInput,
    // Called only when a field changed, with the changed fields' names.
    audit: AuditUpdateBuilder<SessionDTO, SessionAuditField>,
  ): Promise<SessionUpdateResult>;
}
