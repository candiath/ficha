import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  AppointmentCreateInput,
  AppointmentDTO,
  AppointmentRepository,
  AppointmentUpdateInput,
} from '../appointmentRepository';

const appointmentSelect = {
  id: true,
  patientId: true,
  userId: true,
  episodeId: true,
  sessionId: true,
  seriesId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  cancelledAt: true,
  patient: { select: { fullName: true } },
  episode: { select: { mainComplaint: true } },
} as const;

type Row = {
  id: string;
  patientId: string;
  userId: string;
  episodeId: string | null;
  sessionId: string | null;
  seriesId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentDTO['status'];
  notes: string | null;
  cancelledAt: Date | null;
  patient: { fullName: string };
  episode: { mainComplaint: string | null } | null;
};

function toDTO(row: Row): AppointmentDTO {
  return {
    id: row.id,
    patientId: row.patientId,
    patientName: row.patient.fullName,
    userId: row.userId,
    episodeId: row.episodeId,
    episodeMainComplaint: row.episode?.mainComplaint ?? null,
    sessionId: row.sessionId,
    seriesId: row.seriesId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    notes: row.notes,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

export const prismaAppointmentRepository: AppointmentRepository = {
  async listInRange(
    ctx: TenantContext,
    desde: Date,
    hasta: Date,
  ): Promise<AppointmentDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.appointment.findMany({
      // Medio abierto: el fin de una semana es exactamente el comienzo de la
      // siguiente, así que un turno a medianoche aparece en una sola.
      where: { startsAt: { gte: desde, lt: hasta } },
      orderBy: { startsAt: 'asc' },
      select: appointmentSelect,
    });
    return rows.map(toDTO);
  },

  async getById(ctx: TenantContext, id: string): Promise<AppointmentDTO | null> {
    const db = forTenant(ctx);
    const row = await db.appointment.findFirst({ where: { id }, select: appointmentSelect });
    return row ? toDTO(row) : null;
  },

  async create(
    ctx: TenantContext,
    input: AppointmentCreateInput,
  ): Promise<AppointmentDTO[]> {
    const db = forTenant(ctx);

    // Un solo hueco no es una serie: dejarle el seriesId en null evita que
    // después "cancelar la serie" alcance a un turno suelto.
    const seriesId = input.slots.length > 1 ? randomUUID() : null;

    // Todos o ninguno: una serie a medias es peor que ninguna serie, porque
    // el usuario cree que agendó diez y agendó seis.
    //
    // Nota multi-tenant: el `tx` de una transacción interactiva no está
    // reescrito por TenantScopedClient, así que el tenantId va explícito (ver
    // #55 y el mismo comentario en prismaSessionRepository).
    return db.$transaction(async (tx) => {
      const creados = [];
      for (const slot of input.slots) {
        const row = await tx.appointment.create({
          data: {
            tenantId: ctx.tenantId,
            patientId: input.patientId,
            // El turno queda atribuido a quien lo agenda. Cuando haga falta
            // agendar para otro profesional, esto pasa a venir del body y se
            // valida contra el tenant; hoy sería una opción sin usuario.
            userId: ctx.userId,
            episodeId: input.episodeId ?? null,
            notes: input.notes ?? null,
            seriesId,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
          },
          select: appointmentSelect,
        });
        creados.push(toDTO(row));
      }
      return creados;
    });
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: AppointmentUpdateInput,
  ): Promise<AppointmentDTO | null> {
    const db = forTenant(ctx);
    try {
      const row = await db.appointment.update({
        where: { id },
        data: {
          ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
          ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
          ...(input.episodeId !== undefined && { episodeId: input.episodeId }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.status !== undefined && {
            status: input.status,
            // cancelledAt acompaña al estado y no se pide por separado: es
            // cuándo pasó lo que el estado dice, no un dato independiente.
            cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
          }),
        },
        select: appointmentSelect,
      });
      return toDTO(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null;
      }
      throw e;
    }
  },

  async cancelSeriesFrom(
    ctx: TenantContext,
    seriesId: string,
    desde: Date,
  ): Promise<number> {
    const db = forTenant(ctx);
    const { count } = await db.appointment.updateMany({
      where: {
        seriesId,
        startsAt: { gte: desde },
        // Solo lo que sigue pendiente: un turno ya cancelado no cambia, y uno
        // COMPLETED o NO_SHOW ya es historial.
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return count;
  },
};
