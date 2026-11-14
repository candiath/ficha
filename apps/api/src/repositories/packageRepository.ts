import type { AuditBuilder } from './auditLogRepository';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// usedSessions/remainingSessions se derivan del count de pagos que debitaron
// el paquete: el paquete no guarda un contador propio.
export interface PackageDTO {
  id: string;
  patientId: string;
  patientName: string;
  name: string;
  totalSessions: number;
  pricePerSessionCents: number;
  usedSessions: number;
  remainingSessions: number;
  notes: string | null;
  createdAt: string;
}

export interface PackageCreateInput {
  patientId: string;
  name: string;
  totalSessions: number;
  pricePerSessionCents: number;
  notes?: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface PackageRepository {
  list(ctx: TenantContext, filters?: { patientId?: string }): Promise<PackageDTO[]>;
  create(ctx: TenantContext, input: PackageCreateInput, audit: AuditBuilder<PackageDTO>): Promise<PackageDTO>;
  /**
   * Borra solo si ningún pago debitó el paquete. La regla vive acá y viaja
   * en el where del delete: sin ventana entre chequeo y borrado.
   *
   * The audit entry is built from the row, because the route knows only the
   * package's id and the row names its patient.
   */
  deleteIfUnused(
    ctx: TenantContext,
    id: string,
    audit: AuditBuilder<{ id: string; patientId: string }>,
  ): Promise<'deleted' | 'not_found' | 'in_use'>;
  /** true si el paquete existe, es del tenant y pertenece al paciente. */
  belongsToPatient(ctx: TenantContext, packageId: string, patientId: string): Promise<boolean>;
}
