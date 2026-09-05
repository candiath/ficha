import type { AppointmentStatus } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// startsAt/endsAt salen como instantes ISO. La hora de pared de la clínica la
// agrega la ruta con lib/clinicTime y Tenant.timezone: convertir es
// presentación, y el repositorio no tiene por qué conocer la configuración.
export interface AppointmentDTO {
  id: string;
  patientId: string;
  patientName: string;
  userId: string;
  episodeId: string | null;
  episodeMainComplaint: string | null;
  /** La sesión que salió de este turno, si el paciente vino y se registró. */
  sessionId: string | null;
  /** Compartido por los turnos de una misma serie recurrente. */
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
  cancelledAt: string | null;
}

/** Un hueco de agenda. La recurrencia se materializa como varios de éstos. */
export interface AppointmentSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface AppointmentCreateInput {
  patientId: string;
  episodeId?: string | null;
  notes?: string | null;
  /** Uno solo, o los N de una serie recurrente. */
  slots: AppointmentSlot[];
}

export interface AppointmentUpdateInput {
  startsAt?: Date;
  endsAt?: Date;
  status?: AppointmentStatus;
  episodeId?: string | null;
  notes?: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AppointmentRepository {
  /**
   * Los turnos de la clínica en `[desde, hasta)`. Es la única consulta que
   * hace la agenda, y la que sostiene el índice `[tenantId, startsAt]`.
   *
   * Incluye los cancelados: la agenda decide si los pinta o no, y esconderlos
   * acá haría imposible mostrar "este turno se canceló" sin otra query.
   */
  listInRange(ctx: TenantContext, desde: Date, hasta: Date): Promise<AppointmentDTO[]>;

  /** null si no existe o es de otra clínica. */
  getById(ctx: TenantContext, id: string): Promise<AppointmentDTO | null>;

  /**
   * Crea uno o varios turnos. Con más de un slot, todos comparten un
   * `seriesId` nuevo y se escriben en una transacción: una serie a medias
   * sería peor que ninguna.
   */
  create(ctx: TenantContext, input: AppointmentCreateInput): Promise<AppointmentDTO[]>;

  /** null si el turno no existe o es de otra clínica. */
  update(
    ctx: TenantContext,
    id: string,
    input: AppointmentUpdateInput,
  ): Promise<AppointmentDTO | null>;

  /**
   * Cancela los turnos de una serie que todavía no ocurrieron.
   *
   * Es el caso de un tratamiento de diez sesiones que se suspende en la
   * tercera: las que ya pasaron son historial y no se tocan, y las futuras se
   * cancelan de una. Solo alcanza a los que siguen SCHEDULED o CONFIRMED —
   * uno ya cancelado no cambia, y uno pasado sin resolver tampoco, porque
   * puede haber ocurrido y faltar registrarlo.
   *
   * Devuelve cuántos se cancelaron; 0 si la serie no existe o ya no queda
   * nada por cancelar.
   */
  cancelSeriesFrom(ctx: TenantContext, seriesId: string, desde: Date): Promise<number>;
}
