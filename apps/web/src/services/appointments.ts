import { api } from '@/lib/api';
import type {
  Appointment,
  AppointmentCreateInput,
  AppointmentUpdateInput,
} from '@ficha/shared';

export const appointmentKeys = {
  all: ['appointments'] as const,
  range: (from: string, to: string) => ['appointments', from, to] as const,
};

export const appointmentApi = {
  /** Ambos extremos inclusive, en días de la clínica. */
  list: (from: string, to: string) =>
    api.get<Appointment[]>(`/api/appointments?from=${from}&to=${to}`),

  /** Devuelve un arreglo: con `repeat` crea la serie entera. */
  create: (data: AppointmentCreateInput) =>
    api.post<Appointment[]>('/api/appointments', data),

  update: (id: string, data: AppointmentUpdateInput) =>
    api.patch<Appointment>(`/api/appointments/${id}`, data),

  /** Cancela los turnos de la misma serie que todavía no ocurrieron. */
  cancelSeries: (id: string) =>
    api.post<{ cancelled: number }>(`/api/appointments/${id}/cancel-series`, {}),
};
