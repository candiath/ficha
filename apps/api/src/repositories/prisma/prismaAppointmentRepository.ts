import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AUDIT_APPOINTMENT_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { fullName, patientNameSelect } from './patientName';
import { recordAudits } from './recordAudit';
import type { AuditBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import type {
  AppointmentAuditField,
  AppointmentChange,
  AppointmentCreateInput,
  AppointmentDTO,
  AppointmentListItemDTO,
  AppointmentRepository,
  AppointmentUpdateAudit,
  AppointmentUpdateInput,
} from '../appointmentRepository';

// The range the agenda reads spans patients: no clinical text and no free
// text (#186, SPEC-list-minimization.md §2). Selected column by column.
const appointmentListSelect = {
  id: true,
  patientId: true,
  userId: true,
  episodeId: true,
  sessionId: true,
  seriesId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  cancelledAt: true,
  patient: { select: patientNameSelect },
} as const;

// One appointment: the list's columns and its notes.
const appointmentSelect = { ...appointmentListSelect, notes: true } as const;

type ListRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentListSelect }>;
type Row = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

function toListItemDTO(row: ListRow): AppointmentListItemDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: fullName(row.patient),
    userId: row.userId,
    episodeId: row.episodeId,
    sessionId: row.sessionId,
    seriesId: row.seriesId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

function toDTO(row: Row): AppointmentDTO {
  return { ...toListItemDTO(row), notes: row.notes };
}

const AUDIT_FIELDS = Object.keys(AUDIT_APPOINTMENT_FIELDS) as AppointmentAuditField[];

// What the write did, from the row before and after it. null when nothing
// changed. Cancelling is a fact of its own, so the status stops being one of
// the changed fields, and a cancellation that also edits the notes is two facts.
function changeOf(before: AppointmentDTO, after: AppointmentDTO): AppointmentChange | null {
  const cancelled = after.status === 'CANCELLED' && before.status !== 'CANCELLED';
  const changed = changedFields(before, after, AUDIT_FIELDS).filter((f) => !(cancelled && f === 'status'));
  const fields = nonEmpty(changed);
  return cancelled || fields ? { cancelled, changedFields: fields } : null;
}

export const prismaAppointmentRepository: AppointmentRepository = {
  async listInRange(
    ctx: TenantContext,
    desde: Date,
    hasta: Date,
  ): Promise<AppointmentListItemDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.appointment.findMany({
      // Medio abierto: el fin de una semana es exactamente el comienzo de la
      // siguiente, así que un turno a medianoche aparece en una sola.
      // A deleted patient's appointments are pending work that can no longer
      // happen: hidden, not cancelled, so restoring her brings them back
      // (CLAUDE.md, "Borrado de pacientes").
      where: { startsAt: { gte: desde, lt: hasta }, patient: { deletedAt: null } },
      orderBy: { startsAt: 'asc' },
      select: appointmentListSelect,
    });
    return rows.map(toListItemDTO);
  },

  async getById(ctx: TenantContext, id: string): Promise<AppointmentDTO | null> {
    const db = forTenant(ctx);
    const row = await db.appointment.findFirst({
      where: { id, patient: { deletedAt: null } },
      select: appointmentSelect,
    });
    return row ? toDTO(row) : null;
  },

  async create(
    ctx: TenantContext,
    input: AppointmentCreateInput,
    audit: AuditBuilder<AppointmentDTO>,
  ): Promise<AppointmentDTO[]> {
    const db = forTenant(ctx);

    // Un solo hueco no es una serie: dejarle el seriesId en null evita que
    // después "cancelar la serie" alcance a un turno suelto.
    const seriesId = input.slots.length > 1 ? randomUUID() : null;

    const filas = input.slots.map((slot) => ({
      tenantId: ctx.tenantId,
      patientId: input.patientId,
      // El turno queda atribuido a quien lo agenda. Cuando haga falta agendar
      // para otro profesional, esto pasa a venir del body y se valida contra
      // el tenant; hoy sería una opción sin usuario.
      userId: ctx.userId,
      episodeId: input.episodeId ?? null,
      notes: input.notes ?? null,
      seriesId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    }));

    // Un solo INSERT y no uno por turno dentro de una transacción interactiva.
    // Todos o ninguno igual —createMany es atómico— pero además entra en un
    // viaje de ida y vuelta en lugar de diez: con la latencia de un runner de
    // CI contra Neon, el bucle se comía el timeout de 5 s de `$transaction` y
    // la serie fallaba entera. El test lo atrapó en CI y no en local, que es
    // exactamente para lo que sirve tener latencia real en el medio.
    //
    // AndReturn para saber qué ids les tocó y releer exactamente estas filas
    // con sus relaciones. Los ids los genera Prisma (UUIDv7, #174): antes se
    // armaban acá con randomUUID() porque createMany no los devuelve, y
    // quedaban v4 mientras el resto de las tablas es v7.
    //
    // The audit rows go in the same transaction, also as one INSERT (#188).
    return db.$transaction(async (tx) => {
      const ids = await tx.appointment.createManyAndReturn({ data: filas, select: { id: true } });

      const creadas = await tx.appointment.findMany({
        where: { id: { in: ids.map((f) => f.id) }, tenantId: ctx.tenantId },
        orderBy: { startsAt: 'asc' },
        select: appointmentSelect,
      });
      const turnos = creadas.map(toDTO);
      await recordAudits(tx, ctx, turnos.map(audit));
      return turnos;
    });
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: AppointmentUpdateInput,
    audit: AppointmentUpdateAudit,
  ): Promise<AppointmentDTO | null> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // Locked and read first: what the update did is decided against the
      // stored row, and a concurrent edit waits for this one.
      await lockRow(tx, 'appointments', id, ctx.tenantId);
      const found = await tx.appointment.findFirst({
        where: { id, tenantId: ctx.tenantId, patient: { deletedAt: null } },
        select: appointmentSelect,
      });
      if (!found) return null;
      const before = toDTO(found);

      const row = await tx.appointment.update({
        where: { id, tenantId: ctx.tenantId },
        data: {
          ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
          ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
          ...(input.episodeId !== undefined && { episodeId: input.episodeId }),
          ...(input.notes !== undefined && { notes: input.notes }),
          // Only a new status: repeating the one it has keeps cancelledAt,
          // which is when the cancellation happened.
          ...(input.status !== undefined &&
            input.status !== before.status && {
              status: input.status,
              // cancelledAt acompaña al estado y no se pide por separado: es
              // cuándo pasó lo que el estado dice, no un dato independiente.
              cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
            }),
        },
        select: appointmentSelect,
      });
      const turno = toDTO(row);

      const change = changeOf(before, turno);
      if (change) await recordAudits(tx, ctx, audit(turno, change));
      return turno;
    });
  },

  async cancelSeriesFrom(
    ctx: TenantContext,
    seriesId: string,
    desde: Date,
    audit: AuditBuilder<{ id: string; patientId: string }>,
  ): Promise<number> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // Each cancelled appointment gets its audit row, so which ones they are
      // has to be known exactly: the series is locked before reading it, and a
      // concurrent cancel waits here and then finds nothing left to cancel.
      // Raw SQL escapes the tenant-scope extension: the tenant goes by hand.
      await tx.$queryRaw`SELECT 1 FROM "appointments" WHERE "series_id" = ${seriesId}::uuid AND "tenant_id" = ${ctx.tenantId}::uuid FOR UPDATE`;

      const turnos = await tx.appointment.findMany({
        where: {
          tenantId: ctx.tenantId,
          seriesId,
          startsAt: { gte: desde },
          // A series is one patient's, and the route's getById already hides a
          // deleted patient's: this covers a deletion landing in between.
          patient: { deletedAt: null },
          // Solo lo que sigue pendiente: un turno ya cancelado no cambia, y uno
          // COMPLETED o NO_SHOW ya es historial.
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, patientId: true },
      });
      if (turnos.length === 0) return 0;

      await tx.appointment.updateMany({
        where: { id: { in: turnos.map((t) => t.id) }, tenantId: ctx.tenantId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await recordAudits(tx, ctx, turnos.map(audit));
      return turnos.length;
    });
  },
};
