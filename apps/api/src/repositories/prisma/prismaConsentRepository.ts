import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type { AuditBuilder } from '../auditLogRepository';
import type { ConsentRepository, InformedConsentDTO } from '../consentRepository';
import { recordAudit } from './recordAudit';

function toDTO(row: {
  id: string;
  patientId: string;
  signed: boolean;
  signedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): InformedConsentDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    signed: row.signed,
    signedAt: row.signedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const consentSelect = {
  id: true,
  patientId: true,
  signed: true,
  signedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const prismaConsentRepository: ConsentRepository = {
  async getByPatient(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO | null> {
    const db = forTenant(ctx);
    const row = await db.informedConsent.findFirst({
      where: { patientId },
      select: consentSelect,
    });
    return row ? toDTO(row) : null;
  },

  // Both writes record their audit row in the same transaction (#188).

  async sign(
    ctx: TenantContext,
    patientId: string,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<InformedConsentDTO> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      const row = await tx.informedConsent.upsert({
        where: { patientId, tenantId: ctx.tenantId },
        create: {
          tenantId: ctx.tenantId,
          patientId,
          signed: true,
          signedAt: new Date(),
        },
        update: {
          signed: true,
          signedAt: new Date(),
          revokedAt: null,
        },
        select: consentSelect,
      });
      const consent = toDTO(row);
      await recordAudit(tx, ctx, audit(consent));
      return consent;
    });
  },

  async revoke(
    ctx: TenantContext,
    patientId: string,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<InformedConsentDTO | null> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // updateMany and not update: no matching row (the patient never signed,
      // or it belongs to another clinic) is count 0 → 404, instead of a P2025
      // thrown inside the transaction.
      const { count } = await tx.informedConsent.updateMany({
        where: { patientId, tenantId: ctx.tenantId },
        data: { signed: false, revokedAt: new Date() },
      });
      if (count === 0) return null;
      const row = await tx.informedConsent.findFirstOrThrow({
        where: { patientId, tenantId: ctx.tenantId },
        select: consentSelect,
      });
      const consent = toDTO(row);
      await recordAudit(tx, ctx, audit(consent));
      return consent;
    });
  },
};
