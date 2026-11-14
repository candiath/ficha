import { forTenant } from '../../lib/tenantScope';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../types';
import type { AuditBuilder } from '../auditLogRepository';
import type { ConsentRepository, ConsentSignResult, InformedConsentDTO } from '../consentRepository';
import { lockRow } from './changedFields';
import { recordAudit } from './recordAudit';
import { recordRevision } from './recordRevision';
import { consentSnapshot } from './clinicalSnapshots';

const consentSelect = {
  id: true,
  patientId: true,
  signedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  // The latest version; none is version 0.
  revisions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} as const;

type ConsentRow = Prisma.InformedConsentGetPayload<{ select: typeof consentSelect }>;

function toDTO(row: ConsentRow): InformedConsentDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    signed: row.revokedAt === null,
    signedAt: row.signedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.revisions[0]?.version ?? 0,
  };
}

export const prismaConsentRepository: ConsentRepository = {
  async getByPatient(ctx: TenantContext, patientId: string): Promise<InformedConsentDTO | null> {
    const db = forTenant(ctx);
    const row = await db.informedConsent.findFirst({
      where: { patientId },
      select: consentSelect,
    });
    return row ? toDTO(row) : null;
  },

  // Both writes record their audit row and their version in the same
  // transaction (#188). Both lock the patient: before the first signature there
  // is no consent row to lock, and sign and revoke must wait for each other.

  async sign(
    ctx: TenantContext,
    patientId: string,
    expectedVersion: number | undefined,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<ConsentSignResult> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx): Promise<ConsentSignResult> => {
      await lockRow(tx, 'patients', patientId, ctx.tenantId);
      const before = await tx.informedConsent.findFirst({
        where: { patientId, tenantId: ctx.tenantId },
        select: consentSelect,
      });
      const version = before?.revisions[0]?.version ?? 0;
      if (expectedVersion !== undefined && expectedVersion !== version) return { ok: false, reason: 'stale' };

      const row = await tx.informedConsent.upsert({
        where: { patientId, tenantId: ctx.tenantId },
        create: {
          tenantId: ctx.tenantId,
          patientId,
          signedAt: new Date(),
        },
        update: {
          signedAt: new Date(),
          revokedAt: null,
        },
        select: consentSelect,
      });
      // Signing is a fact, not a correction: a version with no reason (§4).
      const consent = { ...toDTO(row), version: version + 1 };
      const auditLogId = await recordAudit(tx, ctx, audit(consent));
      await recordRevision(tx, ctx, 'consent_revisions', {
        aggregateId: row.id,
        patientId,
        version: consent.version,
        auditLogId,
        snapshot: consentSnapshot(row),
      });
      return { ok: true, consent };
    });
  },

  async revoke(
    ctx: TenantContext,
    patientId: string,
    audit: AuditBuilder<InformedConsentDTO>,
  ): Promise<InformedConsentDTO | null> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      await lockRow(tx, 'patients', patientId, ctx.tenantId);
      // updateMany and not update: no matching row (the patient never signed,
      // or it belongs to another clinic) is count 0 → 404, instead of a P2025
      // thrown inside the transaction.
      const { count } = await tx.informedConsent.updateMany({
        where: { patientId, tenantId: ctx.tenantId },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return null;
      const row = await tx.informedConsent.findFirstOrThrow({
        where: { patientId, tenantId: ctx.tenantId },
        select: consentSelect,
      });
      // Revoking is a fact too: a version with no reason.
      const consent = { ...toDTO(row), version: (row.revisions[0]?.version ?? 0) + 1 };
      const auditLogId = await recordAudit(tx, ctx, audit(consent));
      await recordRevision(tx, ctx, 'consent_revisions', {
        aggregateId: row.id,
        patientId,
        version: consent.version,
        auditLogId,
        snapshot: consentSnapshot(row),
      });
      return consent;
    });
  },
};
