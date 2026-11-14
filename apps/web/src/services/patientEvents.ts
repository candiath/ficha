import { api } from '@/lib/api';
import type { PatientEvent, PatientEventInput } from '@/types/patientEvent';
import type { AnnulData, RevisionMeta } from '@/types/patient';

export const patientEventKeys = {
  list: (patientId: string) => ['patients', patientId, 'events'] as const,
};

export const patientEventApi = {
  list: (patientId: string) => api.get<PatientEvent[]>(`/api/patients/${patientId}/events`),
  create: (patientId: string, data: PatientEventInput) =>
    api.post<PatientEvent>(`/api/patients/${patientId}/events`, data),
  update: (patientId: string, eventId: string, data: Partial<PatientEventInput> & RevisionMeta) =>
    api.patch<PatientEvent>(`/api/patients/${patientId}/events/${eventId}`, data),
  // Annulled, never deleted (SPEC-clinical-revisions.md §8).
  annul: (patientId: string, eventId: string, data: AnnulData) =>
    api.post<void>(`/api/patients/${patientId}/events/${eventId}/annul`, data),
};
