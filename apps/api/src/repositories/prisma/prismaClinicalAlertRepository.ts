import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  AlertCreateDTO,
  AlertFilters,
  ClinicalAlertDTO,
  ClinicalAlertRepository,
} from '../clinicalAlertRepository';

// Las alertas de pacientes borrados no se muestran ni se cuentan.
//
// Es la excepción a la política general de borrado lógico (ver
// patientRepository): cobros, sesiones y paquetes son registros de lo que
// pasó y conservan el nombre, pero una alerta es TRABAJO PENDIENTE — pide
// contactar a alguien cuya ficha ya da 404, y engorda el badge de no leídas
// con ítems sobre los que no se puede actuar.
//
// Se filtra en la lectura y no se borran las filas al eliminar el paciente:
// el borrado es lógico y reversible, así que las alertas deben poder volver
// con él. Además cubre las que ya existían, sin migración de datos.
const visiblePatient = { patient: { deletedAt: null } };

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
    const db = forTenant(ctx);
    const where: Record<string, unknown> = { ...visiblePatient };
    if (filters?.type) where.type = filters.type;
    if (filters?.isRead !== undefined) where.isRead = filters.isRead;

    const rows = await db.clinicalAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: alertSelect,
    });
    return rows.map(toDTO);
  },

  async hasRecentUnread(
    ctx: TenantContext,
    patientId: string,
    type: AlertCreateDTO['type'],
    since: Date,
  ): Promise<boolean> {
    const db = forTenant(ctx);
    const row = await db.clinicalAlert.findFirst({
      where: { patientId, type, isRead: false, createdAt: { gte: since } },
      select: { id: true },
    });
    return row !== null;
  },

  async stats(ctx: TenantContext) {
    const db = forTenant(ctx);
    // Mismo filtro que list(): el badge cuenta lo que la lista muestra.
    const [unread, followUp, payment, noShow] = await Promise.all([
      db.clinicalAlert.count({ where: { ...visiblePatient, isRead: false } }),
      db.clinicalAlert.count({
        where: { ...visiblePatient, type: 'FOLLOW_UP', isRead: false },
      }),
      db.clinicalAlert.count({
        where: { ...visiblePatient, type: 'PAYMENT', isRead: false },
      }),
      db.clinicalAlert.count({
        where: { ...visiblePatient, type: 'NO_SHOW', isRead: false },
      }),
    ]);
    return { unread, followUp, payment, noShow };
  },

  async create(ctx: TenantContext, data: AlertCreateDTO): Promise<ClinicalAlertDTO> {
    const db = forTenant(ctx);
    const row = await db.clinicalAlert.create({
      data: {
        patientId: data.patientId,
        type: data.type,
        message: data.message,
      },
      select: alertSelect,
    });
    return toDTO(row);
  },

  async markAsRead(ctx: TenantContext, id: string): Promise<ClinicalAlertDTO | null> {
    const db = forTenant(ctx);
    // updateMany y no update: existencia y pertenencia al tenant se deciden
    // en la misma query que escribe (count 0 = no hay alerta del tenant con
    // ese id), sin ventana entre chequeo y update — patrón de
    // patientRepo.update. null → la ruta responde 404 (antes el throw
    // genérico terminaba en un 500 del errorHandler).
    const { count } = await db.clinicalAlert.updateMany({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    if (count === 0) return null;

    const row = await db.clinicalAlert.findFirst({
      where: { id },
      select: alertSelect,
    });
    return row ? toDTO(row) : null;
  },

  async markAllAsRead(ctx: TenantContext): Promise<number> {
    const db = forTenant(ctx);
    const result = await db.clinicalAlert.updateMany({
      where: { isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  },
};
