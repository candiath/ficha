import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface InformedConsentDTO {
  id: string;
  patientId: string;
  signed: boolean;
  signedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface ConsentRepository {
  getByPatient(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO | null>;
  sign(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO>;
  /** null si el paciente no tiene consentimiento: no hay nada que revocar. */
  revoke(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO | null>;
}
