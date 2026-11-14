import { api } from '@/lib/api';
import type { DeletedPatient, Patient, PatientFormData, RevisionMeta } from '@/types/patient';

export const patientKeys = {
  all: ['patients'] as const,
  detail: (id: string) => ['patients', id] as const,
  deleted: ['patients', 'deleted'] as const,
};

export const patientApi = {
  list: () => api.get<Patient[]>('/api/patients'),
  get: (id: string) => api.get<Patient>(`/api/patients/${id}`),
  create: (data: PatientFormData) => api.post<Patient>('/api/patients', data),
  update: (id: string, data: Partial<PatientFormData> & RevisionMeta) =>
    api.patch<Patient>(`/api/patients/${id}`, data),
  remove: (id: string) => api.delete(`/api/patients/${id}`),
  listDeleted: () => api.get<DeletedPatient[]>('/api/patients/deleted'),
  restore: (id: string) => api.post<void>(`/api/patients/${id}/restore`, {}),
};
