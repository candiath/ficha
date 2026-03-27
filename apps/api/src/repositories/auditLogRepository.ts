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

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AuditLogRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<AuditLogDTO[]>;
  create(ctx: TenantContext, data: AuditLogCreateDTO): Promise<AuditLogDTO>;
}
