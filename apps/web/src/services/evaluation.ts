import { api } from '@/lib/api';
import type { EvaluationUpsertData, InitialEvaluation } from '@/types/evaluation';

export const evaluationKeys = {
  detail: (patientId: string) => ['patients', patientId, 'evaluation'] as const,
};

export const evaluationApi = {
  get: (patientId: string) =>
    api.get<InitialEvaluation | null>(`/api/patients/${patientId}/evaluation`),
  upsert: (patientId: string, data: EvaluationUpsertData) =>
    api.put<InitialEvaluation>(`/api/patients/${patientId}/evaluation`, data),
};
