import type { PatientEventKind } from '@prisma/client';
import type { AUDIT_PATIENT_EVENT_FIELDS, PartialDate } from '@ficha/shared';
import type { TenantContext } from './types';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Something the patient lived (#238): an entry of her history. `occurred` is
// the partial date as written (null when she does not know when).
export interface PatientEventDTO {
  id: string;
  patientId: string;
  kind: PatientEventKind;
  description: string;
  occurred: PartialDate | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientEventInput {
  kind: PatientEventKind;
  description: string;
  occurred: PartialDate | null;
}

export type PatientEventAuditField = keyof typeof AUDIT_PATIENT_EVENT_FIELDS;

// ─── Port ────────────────────────────────────────────────────────────────────

// Like sessions: an event of another patient counts as nonexistent, and one
// deleted is gone from every method. The patient's existence is the route's
// (patientRepo.exists).
export interface PatientEventRepository {
  /** The patient's current history: dated ones newest first, undated last. */
  listByPatient(ctx: TenantContext, patientId: string): Promise<PatientEventDTO[]>;
  create(
    ctx: TenantContext,
    patientId: string,
    input: PatientEventInput,
    audit: AuditBuilder<PatientEventDTO>,
  ): Promise<PatientEventDTO>;
  /** null: no current event of that patient with that id. */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: Partial<PatientEventInput>,
    // Called only when a field changed, with the changed fields' names.
    audit: AuditUpdateBuilder<PatientEventDTO, PatientEventAuditField>,
  ): Promise<PatientEventDTO | null>;
  /** Logical: the row stays for the audit trail. */
  softDelete(
    ctx: TenantContext,
    patientId: string,
    id: string,
    audit: (deleted: PatientEventDTO) => AuditEntry,
  ): Promise<'deleted' | 'not_found'>;
}
