import type { Prisma } from '@prisma/client';
import {
  auditEntityOf,
  type AuditParams,
  type AuditTakesEntity,
  type AuditWritableAction,
} from '@ficha/shared';
import type { OperatorContext } from '../types';
import { AuditEntryError, assertAuditEntry } from './recordAudit';

type PlatformWritableAction = AuditWritableAction<'platform_audit_logs'>;

// One platform audit entry: the action, the clinic it touched (none for an
// action on the platform itself), the user it touched, the object it touched
// when the catalog says the action has one (the reset link generated, the
// test alert sent), and its parameters, all typed from the catalog in
// packages/shared.
export type PlatformAuditEntry = {
  [A in PlatformWritableAction]: {
    action: A;
    tenantId?: string;
    targetUserId?: string;
    params: AuditParams<'platform_audit_logs', A>;
  } & (AuditTakesEntity<'platform_audit_logs', A> extends true ? { entityId: string } : { entityId?: never });
}[PlatformWritableAction];

// Writes a platform_audit_logs row in the transaction of the action it
// records, after checking it against the catalog, as recordAudit does for
// audit_logs (SPEC-audit-structured-entries.md §4). The entity type comes from
// the catalog, never from the caller.
export async function recordPlatformAudit(
  tx: Prisma.TransactionClient,
  op: OperatorContext,
  entry: PlatformAuditEntry,
): Promise<void> {
  assertAuditEntry('platform_audit_logs', entry.action, entry.params);
  const entity = auditEntityOf('platform_audit_logs', entry.action) ?? null;
  const entityId = entry.entityId ?? null;
  // The types already require it; this is the backstop for a caller that
  // casts its way around them.
  if ((entity === null) !== (entityId === null)) {
    throw new AuditEntryError(`entity id ${entityId ? 'not expected' : 'required'} for ${entry.action}`);
  }
  await tx.platformAuditLog.create({
    data: {
      operatorId: op.operatorId,
      tenantId: entry.tenantId,
      targetUserId: entry.targetUserId,
      action: entry.action,
      entity,
      entityId,
      params: entry.params,
      actorType: 'OPERATOR',
    },
    select: { id: true },
  });
}
