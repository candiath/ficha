import { api } from '@/lib/api';
import type {
  TreatmentCycle,
  TreatmentCycleCreateData,
  TreatmentCycleUpdateData,
} from '@/types/treatmentCycle';

export const treatmentCycleKeys = {
  list: (patientId: string) => ['patients', patientId, 'cycles'] as const,
};

export const treatmentCycleApi = {
  list: (patientId: string) =>
    api.get<TreatmentCycle[]>(`/api/patients/${patientId}/cycles`),

  create: (patientId: string, data: TreatmentCycleCreateData) =>
    api.post<TreatmentCycle>(`/api/patients/${patientId}/cycles`, data),

  update: (patientId: string, cycleId: string, data: TreatmentCycleUpdateData) =>
    api.patch<TreatmentCycle>(`/api/patients/${patientId}/cycles/${cycleId}`, data),

  delete: (patientId: string, cycleId: string) =>
    api.delete(`/api/patients/${patientId}/cycles/${cycleId}`),
};
