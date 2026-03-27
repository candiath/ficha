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
  revoke(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO>;
}
