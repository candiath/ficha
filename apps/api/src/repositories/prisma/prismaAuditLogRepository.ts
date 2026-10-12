import type { Prisma } from '@prisma/client';
import { readAuditParams } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  AuditLogDTO,
  AuditLogRepository,
} from '../auditLogRepository';

const auditSelect = {
  id: true,
  patientId: true,
  userId: true,
  actorType: true,
  entity: true,
  entityId: true,
  action: true,
  params: true,
  createdAt: true,
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

// params are read leniently: a row may predate a parameter, or carry one this
// version does not know (SPEC-audit-structured-entries.md §5).
function toDTO(row: AuditRow): AuditLogDTO {
  return {
    ...row,
    params: readAuditParams('audit_logs', row.action, row.params),
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaAuditLogRepository: AuditLogRepository = {
  async listByPatient(ctx: TenantContext, patientId: string): Promise<AuditLogDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.auditLog.findMany({
      where: { patientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: auditSelect,
    });
    return rows.map(toDTO);
  },
};
