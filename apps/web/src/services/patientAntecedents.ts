import { api } from '@/lib/api';
import type { PatientAntecedent, PatientAntecedentInput } from '@/types/patientAntecedent';
import type { AnnulData, RevisionMeta } from '@/types/patient';

export const patientAntecedentKeys = {
  list: (patientId: string) => ['patients', patientId, 'antecedents'] as const,
};

export const patientAntecedentApi = {
  list: (patientId: string) => api.get<PatientAntecedent[]>(`/api/patients/${patientId}/antecedents`),
  create: (patientId: string, data: PatientAntecedentInput) =>
    api.post<PatientAntecedent>(`/api/patients/${patientId}/antecedents`, data),
  update: (patientId: string, antecedentId: string, data: Partial<PatientAntecedentInput> & RevisionMeta) =>
    api.patch<PatientAntecedent>(`/api/patients/${patientId}/antecedents/${antecedentId}`, data),
  // Annulled, never deleted (SPEC-clinical-revisions.md §8).
  annul: (patientId: string, antecedentId: string, data: AnnulData) =>
    api.post<void>(`/api/patients/${patientId}/antecedents/${antecedentId}/annul`, data),
};
