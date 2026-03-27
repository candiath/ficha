import { prisma } from '../../lib/prisma';
import type { TenantContext } from '../types';
import type {
  AuditLogCreateDTO,
  AuditLogDTO,
  AuditLogRepository,
} from '../auditLogRepository';

const auditSelect = {
  id: true,
  patientId: true,
  userId: true,
  entity: true,
  entityId: true,
  action: true,
  description: true,
  createdAt: true,
} as const;

function toDTO(row: {
  id: string;
  patientId: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  description: string;
  createdAt: Date;
}): AuditLogDTO {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export const prismaAuditLogRepository: AuditLogRepository = {
  async listByPatient(ctx: TenantContext, patientId: string): Promise<AuditLogDTO[]> {
    const rows = await prisma.auditLog.findMany({
      where: { patientId, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      select: auditSelect,
    });
    return rows.map(toDTO);
  },

  async create(ctx: TenantContext, data: AuditLogCreateDTO): Promise<AuditLogDTO> {
    const row = await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        patientId: data.patientId,
        userId: data.userId ?? ctx.userId ?? null,
        entity: data.entity,
        entityId: data.entityId,
        action: data.action,
        description: data.description,
      },
      select: auditSelect,
    });
    return toDTO(row);
  },
};
