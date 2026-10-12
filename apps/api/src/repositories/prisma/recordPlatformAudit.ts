import type { Prisma } from '@prisma/client';
import type { AuditParams, AuditWritableAction } from '@ficha/shared';
import type { OperatorContext } from '../types';
import { assertAuditEntry } from './recordAudit';

type PlatformWritableAction = AuditWritableAction<'platform_audit_logs'>;

// One platform audit entry: the action, the clinic it touched (none for an
// action on the platform itself), the user it touched, and its parameters,
// typed from the catalog in packages/shared.
export type PlatformAuditEntry = {
  [A in PlatformWritableAction]: {
    action: A;
    tenantId?: string;
    targetUserId?: string;
    params: AuditParams<'platform_audit_logs', A>;
  };
}[PlatformWritableAction];

// Writes a platform_audit_logs row in the transaction of the action it
// records, after checking it against the catalog, as recordAudit does for
// audit_logs (SPEC-audit-structured-entries.md §4).
export async function recordPlatformAudit(
  tx: Prisma.TransactionClient,
  op: OperatorContext,
  entry: PlatformAuditEntry,
): Promise<void> {
  assertAuditEntry('platform_audit_logs', entry.action, entry.params);
  await tx.platformAuditLog.create({
    data: {
      operatorId: op.operatorId,
      tenantId: entry.tenantId,
      targetUserId: entry.targetUserId,
      action: entry.action,
      params: entry.params,
      actorType: 'OPERATOR',
    },
    select: { id: true },
  });
}
