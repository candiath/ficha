import type { TenantContext } from './types';
import type { AuditBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface InformedConsentDTO {
  id: string;
  patientId: string;
  // Derived: signed and not revoked.
  signed: boolean;
  signedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // The latest version (SPEC-clinical-revisions.md); 0 if it has none yet.
  version: number;
}

// `stale`: the screen showed another version of the consent, or none when
// there is one.
export type ConsentSignResult = { ok: true; consent: InformedConsentDTO } | { ok: false; reason: 'stale' };

// ─── Port ────────────────────────────────────────────────────────────────────

export interface ConsentRepository {
  getByPatient(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO | null>;
  sign(
    ctx: TenantContext,
    patientId: string,
    // The version the screen showed: 0 when it showed none.
    expectedVersion: number | undefined,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<ConsentSignResult>;
  /** null si el paciente no tiene consentimiento: no hay nada que revocar. */
  revoke(
    ctx: TenantContext,
    patientId: string,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<InformedConsentDTO | null>;
}
