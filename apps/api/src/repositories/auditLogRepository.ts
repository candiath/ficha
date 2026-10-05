import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface AuditLogDTO {
  id: string;
  patientId: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  description: string;
  createdAt: string;
}

export interface AuditLogCreateDTO {
  patientId: string;
  userId?: string | null;
  entity: 'PATIENT' | 'EVALUATION' | 'SESSION' | 'PAYMENT' | 'CONSENT';
  entityId: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  description: string;
}

// What an audited write records (#188). The repository writes it in the same
// transaction as the change and fills the actor from the context, so an
// action can never land without its audit row.
export type AuditEntry = Omit<AuditLogCreateDTO, 'userId'>;

// Built from the write's result (its id, created vs updated…), inside the
// transaction, right after the write.
export type AuditBuilder<T> = (result: T) => AuditEntry;

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AuditLogRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<AuditLogDTO[]>;
  create(ctx: TenantContext, data: AuditLogCreateDTO): Promise<AuditLogDTO>;
}
