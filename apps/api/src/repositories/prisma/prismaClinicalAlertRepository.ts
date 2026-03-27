import { prisma } from '../../lib/prisma';
import type { TenantContext } from '../types';
import type {
  AlertCreateDTO,
  AlertFilters,
  ClinicalAlertDTO,
  ClinicalAlertRepository,
} from '../clinicalAlertRepository';

const alertSelect = {
  id: true,
  patientId: true,
  type: true,
  message: true,
  isRead: true,
  readAt: true,
  createdAt: true,
  patient: { select: { fullName: true } },
} as const;

function toDTO(row: {
  id: string;
  patientId: string;
  type: string;
  message: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  patient: { fullName: string };
}): ClinicalAlertDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patient.fullName,
    type: row.type,
    message: row.message,
    isRead: row.isRead,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const prismaClinicalAlertRepository: ClinicalAlertRepository = {
  async list(ctx: TenantContext, filters?: AlertFilters): Promise<ClinicalAlertDTO[]> {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId };
    if (filters?.type) where.type = filters.type;
    if (filters?.isRead !== undefined) where.isRead = filters.isRead;

    const rows = await prisma.clinicalAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: alertSelect,
    });
    return rows.map(toDTO);
  },

  async stats(ctx: TenantContext) {
    const [unread, followUp, payment, noShow] = await Promise.all([
      prisma.clinicalAlert.count({ where: { tenantId: ctx.tenantId, isRead: false } }),
      prisma.clinicalAlert.count({ where: { tenantId: ctx.tenantId, type: 'FOLLOW_UP', isRead: false } }),
      prisma.clinicalAlert.count({ where: { tenantId: ctx.tenantId, type: 'PAYMENT', isRead: false } }),
      prisma.clinicalAlert.count({ where: { tenantId: ctx.tenantId, type: 'NO_SHOW', isRead: false } }),
    ]);
    return { unread, followUp, payment, noShow };
  },

  async create(ctx: TenantContext, data: AlertCreateDTO): Promise<ClinicalAlertDTO> {
    const row = await prisma.clinicalAlert.create({
      data: {
        tenantId: ctx.tenantId,
        patientId: data.patientId,
        type: data.type,
        message: data.message,
      },
      select: alertSelect,
    });
    return toDTO(row);
  },

  async markAsRead(ctx: TenantContext, id: string): Promise<ClinicalAlertDTO> {
    const row = await prisma.clinicalAlert.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
      select: alertSelect,
    });
    // Verify tenant ownership
    if (row.patientId) {
      const patient = await prisma.patient.findFirst({
        where: { id: row.patientId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!patient) throw new Error('Alerta no encontrada');
    }
    return toDTO(row);
  },

  async markAllAsRead(ctx: TenantContext): Promise<number> {
    const result = await prisma.clinicalAlert.updateMany({
      where: { tenantId: ctx.tenantId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  },
};
