import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type { ConsentRepository, InformedConsentDTO } from '../consentRepository';

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

  async sign(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO> {
    const db = forTenant(ctx);
    const row = await db.informedConsent.upsert({
      where: { patientId },
      create: {
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
    return toDTO(row);
  },

  async revoke(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO> {
    const db = forTenant(ctx);
    const row = await db.informedConsent.update({
      where: { patientId },
      data: {
        signed: false,
        revokedAt: new Date(),
      },
      select: consentSelect,
    });
    return toDTO(row);
  },
};
