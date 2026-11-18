import type { EncounterType } from '@prisma/client';
import type { TenantContext } from './types';
import type { AUDIT_ENCOUNTER_FIELDS } from '@ficha/shared';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// One problem the encounter treated: its episode, and everything clinical about
// that problem (#238). A visit that treats the back and an ankle has two.
export interface EncounterBlockDTO {
  episodeId: string;
  preEncounterState: string | null;
  treatment: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  patientExercises: string | null;
  reEvaluationNotes: string | null;
}

// The encounter holds the visit itself; `episodes`, one block per problem it
// treated, ordered by episode. `observations` is the text of a note. `version`
// is its latest revision: 0 for an encounter written before revisions existed.
export interface EncounterDTO {
  id: string;
  version: number;
  patientId: string;
  encounterType: EncounterType;
  encounterDate: string;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
  // When it was annulled (SPEC-clinical-revisions.md §8), or null. Only the
  // record's list (listByPatient) returns an annulled encounter; every other
  // reader leaves it out.
  annulledAt: string | null;
  episodes: EncounterBlockDTO[];
}

// The clinic-wide index (GET /api/encounters): who and when, nothing clinical
// (#186, SPEC-list-minimization.md §1). A response that spans patients carries
// no clinical text; the encounter itself is read from the patient's routes.
export interface EncounterIndexItemDTO {
  id: string;
  encounterType: EncounterType;
  encounterDate: string;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
}

export interface EncounterFields {
  encounterType: EncounterType;
  encounterDate: Date;
  observations?: string | null;
}

// A block as written. A field that does not come is left as it was (a new
// block starts empty), the same rule as the encounter's own fields.
export interface EncounterBlockInput {
  episodeId: string;
  preEncounterState?: string | null;
  treatment?: string | null;
  painScaleBefore?: number | null;
  painScaleAfter?: number | null;
  patientExercises?: string | null;
  reEvaluationNotes?: string | null;
}

export interface EncounterPaymentInput {
  packageId?: string | null;
  baseAmountCents: number;
  discountCents: number;
  notes?: string | null;
}

// El POST crea la sesión con su cobro de una sola vez: antes el frontend
// encadenaba varios requests y un fallo intermedio dejaba sesiones sin pago
// (invisibles en Cobros).
export interface EncounterCreateInput extends EncounterFields {
  episodes: EncounterBlockInput[];
  payment?: EncounterPaymentInput;
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

// Which episodes an encounter may treat (#238): an encounter treats at least one, a
// discharge closes exactly one, and a note may stand alone.
export type EncounterBlockRuleViolation = 'needs_episode' | 'discharge_needs_one_episode';

export type EncounterCreateResult =
  | { ok: true; encounter: EncounterDTO }
  // El turno ya produjo su sesión. Pasa si se aprieta dos veces "registrar
  // sesión" o si otra pestaña ganó de mano: la sesión NO se crea, para no
  // duplicar el registro clínico de una misma visita.
  | { ok: false; reason: 'appointment_taken' | EncounterBlockRuleViolation }
  // A discharge closes its episode on the discharge's date (#278), and this
  // one's opening is later. Nothing is recorded.
  | { ok: false; reason: 'discharge_before_opening' }
  // The episode is already closed, discharged or abandoned (#279). Nothing is
  // recorded.
  | { ok: false; reason: 'episode_not_active' };

// What an edit of a discharge may not do (#278): the closing of its episode is
// the discharge's, so it cannot become another type, another type cannot
// become one, and it cannot move to another episode. Annul it and record it
// again instead.
export type DischargeEditViolation = 'discharge_type_fixed' | 'discharge_episode_fixed';

export type EncounterUpdateResult =
  | { ok: true; encounter: EncounterDTO }
  // No current encounter of that patient with that id.
  | { ok: false; reason: 'not_found' | EncounterBlockRuleViolation | DischargeEditViolation }
  // A discharge's corrected date is before its episode's opening.
  | { ok: false; reason: 'discharge_before_opening' }
  // The editor loaded another version: someone saved in between. Nothing is written.
  | { ok: false; reason: 'stale' };

// payment queda afuera a propósito: el pago se edita por /api/payments.
// `episodes`, when it comes, is the whole set of blocks: a block left out is
// removed, a new one is added, and each kept one is updated field by field.
//
// `expectedVersion` is the version the editor loaded; without it the edit applies
// over whatever is there, as the next version. `reasonNote` goes only into the
// revision: it is clinical text, and the audit row holds codes.
export type EncounterUpdateInput = Partial<EncounterFields> & {
  episodes?: EncounterBlockInput[];
  expectedVersion?: number;
  reasonNote?: string | null;
};

// ─── Port ────────────────────────────────────────────────────────────────────

// Como episodios y escalas: los métodos anidados piden patientId, y una
// sesión de otro paciente cuenta como inexistente. La vigencia del paciente
// la exige la ruta con patientRepo.exists; la pertenencia de episodios y
// paquete se valida antes con sus repos.
export type EncounterAuditField = keyof typeof AUDIT_ENCOUNTER_FIELDS;

export interface EncounterRepository {
  listByPatient(
    ctx: TenantContext,
    patientId: string,
    filters?: { episodeId?: string },
  ): Promise<EncounterDTO[]>;
  /** null si la sesión no existe, es de otro paciente o de otro tenant. */
  getById(ctx: TenantContext, patientId: string, id: string): Promise<EncounterDTO | null>;
  /** Every current encounter of the clinic, as an index: no clinical field. */
  listIndexForTenant(ctx: TenantContext): Promise<EncounterIndexItemDTO[]>;
  /**
   * Crea sesión + cobro + cierre de episodios en una transacción: si algo
   * falla no queda una sesión a medias. La sesión se atribuye al usuario del
   * contexto.
   */
  create(
    ctx: TenantContext,
    patientId: string,
    input: EncounterCreateInput,
    audit: AuditBuilder<EncounterDTO>,
  ): Promise<EncounterCreateResult>;
  /**
   * Annuls an encounter entered by mistake (SPEC-clinical-revisions.md §8). It
   * stays in the patient's record, marked, with its content in its history,
   * and leaves every other list and metric. It writes a final version, with
   * the reason's note.
   *
   * - 'not_found': no such encounter of that patient, or already annulled.
   * - 'paid': it has a PAID payment. It is not annulled: money that really
   *   came in does not disappear from here; the payment is reverted first.
   * - 'annulled': deletedAt is set and, if it had a PENDING or WAIVED payment,
   *   that payment is deleted — a pending charge for a visit that did not
   *   happen is not history but work left on something that did not happen.
   *   If it came from an appointment, the appointment loses its encounterId so
   *   the visit can be recorded again; its status does not change.
   */
  annul(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: { reasonNote?: string | null },
    // Built with the annulled encounter and the status of the payment that was
    // deleted with it, or null if it had none.
    audit: (encounter: EncounterDTO, removedPayment: 'PENDING' | 'WAIVED' | null) => AuditEntry,
  ): Promise<'annulled' | 'not_found' | 'paid'>;
  /** not_found if there is no current encounter of that patient with that id. */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: EncounterUpdateInput,
    // Called only when a field changed, with the changed fields' names. A save
    // that changes nothing writes nothing: no row, no audit row, no revision.
    audit: AuditUpdateBuilder<EncounterDTO, EncounterAuditField>,
  ): Promise<EncounterUpdateResult>;
}
