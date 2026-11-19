import type { PatientAntecedentKind } from '@prisma/client';
import type { AUDIT_PATIENT_ANTECEDENT_FIELDS, PartialDate } from '@ficha/shared';
import type { TenantContext } from './types';
import type { AuditBuilder, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Something the patient lived (#238): an entry of her history. `occurred` is
// the partial date as written (null when she does not know when).
export interface PatientAntecedentDTO {
  id: string;
  patientId: string;
  kind: PatientAntecedentKind;
  description: string;
  occurred: PartialDate | null;
  createdAt: string;
  updatedAt: string;
  // The latest version (SPEC-clinical-revisions.md); 0 if it has none yet.
  version: number;
  // When it was annulled (§8), or null. Only listByPatient returns one.
  annulledAt: string | null;
}

// What an edit carries besides the fields (SPEC-clinical-revisions.md §5).
export interface PatientAntecedentEditMeta {
  expectedVersion?: number;
  reasonNote?: string | null;
}

export type PatientAntecedentUpdateResult =
  | { ok: true; antecedent: PatientAntecedentDTO }
  | { ok: false; reason: 'not_found' | 'stale' };

export interface PatientAntecedentInput {
  kind: PatientAntecedentKind;
  description: string;
  occurred: PartialDate | null;
}

export type PatientAntecedentAuditField = keyof typeof AUDIT_PATIENT_ANTECEDENT_FIELDS;

// ─── Port ────────────────────────────────────────────────────────────────────

// Like encounters: an antecedent of another patient counts as nonexistent, and an
// annulled one is listed by the record only. The patient's existence is the route's
// (patientRepo.exists).
export interface PatientAntecedentRepository {
  /** The patient's history, annulled entries included: dated ones newest first, undated last. */
  listByPatient(ctx: TenantContext, patientId: string): Promise<PatientAntecedentDTO[]>;
  create(
    ctx: TenantContext,
    patientId: string,
    input: PatientAntecedentInput,
    audit: AuditBuilder<PatientAntecedentDTO>,
  ): Promise<PatientAntecedentDTO>;
  /** `not_found`: no current antecedent of that patient with that id. */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: Partial<PatientAntecedentInput> & PatientAntecedentEditMeta,
    // Called only when a field changed, with the changed fields' names.
    audit: AuditUpdateBuilder<PatientAntecedentDTO, PatientAntecedentAuditField>,
  ): Promise<PatientAntecedentUpdateResult>;
  /**
   * Annuls an antecedent entered by mistake (SPEC-clinical-revisions.md §8): the
   * row stays, marked, and a final version records it with the reason's note.
   * `not_found`: no current antecedent of that patient with that id.
   */
  annul(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: { reasonNote?: string | null },
    audit: AuditBuilder<PatientAntecedentDTO>,
  ): Promise<'annulled' | 'not_found'>;
}
