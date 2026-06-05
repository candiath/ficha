import { api } from '@/lib/api';
import type {
  TreatmentCycle,
  TreatmentCycleCreateData,
  TreatmentCycleUpdateData,
} from '@/types/treatmentCycle';

export const treatmentCycleKeys = {
  list: (patientId: string, episodeId: string) =>
    ['patients', patientId, 'episodes', episodeId, 'cycles'] as const,
};

export const treatmentCycleApi = {
  list: (patientId: string, episodeId: string) =>
    api.get<TreatmentCycle[]>(
      `/api/patients/${patientId}/episodes/${episodeId}/cycles`,
    ),

  create: (patientId: string, episodeId: string, data: TreatmentCycleCreateData) =>
    api.post<TreatmentCycle>(
      `/api/patients/${patientId}/episodes/${episodeId}/cycles`,
      data,
    ),

  update: (patientId: string, episodeId: string, cycleId: string, data: TreatmentCycleUpdateData) =>
    api.patch<TreatmentCycle>(
      `/api/patients/${patientId}/episodes/${episodeId}/cycles/${cycleId}`,
      data,
    ),

  delete: (patientId: string, episodeId: string, cycleId: string) =>
    api.delete(`/api/patients/${patientId}/episodes/${episodeId}/cycles/${cycleId}`),
};
