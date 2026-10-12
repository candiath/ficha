import type { Prisma } from '@prisma/client';
import { auditEntityOf, auditEntryProblem, type AuditTable } from '@ficha/shared';
import type { AuditEntry } from '../auditLogRepository';
import type { TenantContext } from '../types';

// An audit entry the catalog refuses (#186, SPEC-audit-structured-entries.md §4):
// an unknown or deprecated action, or parameters that do not match it. Always a
// server bug, never bad input, so it is deliberately not a ZodError (which the
// error handler answers as a 400 with the parameter's details): it reaches the
// handler as an unknown error, is logged, answers 500, and the transaction rolls
// the action back with it.
export class AuditEntryError extends Error {
  override name = 'AuditEntryError';
}

export function assertAuditEntry(table: AuditTable, action: string, params: unknown): void {
  const problem = auditEntryProblem(table, action, params);
  if (problem) throw new AuditEntryError(problem);
}

// Writes an audit row with the transaction client of the write it records
// (#188): if either fails, both roll back. tenantId is explicit because the
// interactive transaction client is typed as the base client; at runtime the
// tenant-scope extension injects the same value anyway.
//
// The entity comes from the catalog, never from the caller. `select` keeps the
// INSERT's RETURNING to the id: a column this code does not read can be
// dropped while it still serves.
export async function recordAudit(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  assertAuditEntry('audit_logs', entry.action, entry.params);
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      patientId: entry.patientId,
      entity: auditEntityOf(entry.action)!,
      entityId: entry.entityId,
      action: entry.action,
      params: entry.params,
      actorType: 'USER',
      userId: ctx.userId,
      authSessionId: ctx.authSessionId,
    },
    select: { id: true },
  });
}
