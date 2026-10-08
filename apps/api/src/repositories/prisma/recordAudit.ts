import type { Prisma } from '@prisma/client';
import type { AuditEntry } from '../auditLogRepository';
import type { TenantContext } from '../types';

// Writes an audit row with the transaction client of the write it records
// (#188): if either fails, both roll back. tenantId is explicit because the
// interactive transaction client is typed as the base client; at runtime the
// tenant-scope extension injects the same value anyway.
export async function recordAudit(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: { ...entry, tenantId: ctx.tenantId, userId: ctx.userId },
  });
}
