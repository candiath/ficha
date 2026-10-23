import { api } from '@/lib/api';
import type { PatientEvent, PatientEventInput } from '@/types/patientEvent';

export const patientEventKeys = {
  list: (patientId: string) => ['patients', patientId, 'events'] as const,
};

export const patientEventApi = {
  list: (patientId: string) => api.get<PatientEvent[]>(`/api/patients/${patientId}/events`),
  create: (patientId: string, data: PatientEventInput) =>
    api.post<PatientEvent>(`/api/patients/${patientId}/events`, data),
  update: (patientId: string, eventId: string, data: Partial<PatientEventInput>) =>
    api.patch<PatientEvent>(`/api/patients/${patientId}/events/${eventId}`, data),
  // Logical: it leaves the record, the row stays for the audit trail.
  remove: (patientId: string, eventId: string) => api.delete(`/api/patients/${patientId}/events/${eventId}`),
};
