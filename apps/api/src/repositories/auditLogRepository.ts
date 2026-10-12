import type { AuditActorType, AuditParams, AuditWritableAction, ClinicalAuditAction } from '@ficha/shared';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface AuditLogDTO {
  id: string;
  patientId: string;
  userId: string | null;
  actorType: AuditActorType;
  entity: string;
  entityId: string;
  action: ClinicalAuditAction;
  // Codes only (#186, SPEC-audit-structured-entries.md): the screens read them
  // with readAuditParams / describeAuditEntry from @ficha/shared.
  params: Record<string, unknown>;
  // Built from the catalog, for a web that predates it. Goes away with
  // release 2 of SPEC-audit-structured-entries.md.
  description: string;
  createdAt: string;
}

type ClinicalWritableAction = AuditWritableAction<'audit_logs'>;

// What an audited write records (#188): an action from the catalog in
// packages/shared/src/auditActions.ts, the entity it touched and its
// parameters, typed from the catalog. The repository writes it in the same
// transaction as the change, fills the actor from the context and the entity
// type from the catalog, so an action can never land without its audit row.
//
// No free text and no values (#186): the parameters are codes, checked against
// the catalog before the insert and by the database after it. Audit rows can
// never change, so a value copied into one could never be corrected or erased;
// it lives in its own row.
export type AuditEntry = {
  [A in ClinicalWritableAction]: {
    action: A;
    patientId: string;
    entityId: string;
    params: AuditParams<'audit_logs', A>;
  };
}[ClinicalWritableAction];

// Built from the write's result (its id, created vs updated…), inside the
// transaction, right after the write.
export type AuditBuilder<T> = (result: T) => AuditEntry;

// For an update: also given the names of the fields whose value changed,
// never empty. An update that changes nothing records nothing (SPEC §4).
export type AuditUpdateBuilder<T, F extends string> = (result: T, changedFields: [F, ...F[]]) => AuditEntry;

// ─── Port ────────────────────────────────────────────────────────────────────

// Read-only on purpose (#188): there is no standalone create. Audit rows are
// written by the repository of each audited write, with the same transaction
// client (prisma/recordAudit.ts), so a route cannot go back to recording an
// action separately — and losing the row when that second write fails.
export interface AuditLogRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<AuditLogDTO[]>;
}
