import { api } from '@/lib/api';
import type { EvaluationUpsertData, InitialEvaluation } from '@/types/evaluation';

export const evaluationKeys = {
  detail: (patientId: string, episodeId: string) =>
    ['patients', patientId, 'episodes', episodeId, 'evaluation'] as const,
};

export const evaluationApi = {
  get: (patientId: string, episodeId: string) =>
    api.get<InitialEvaluation | null>(
      `/api/patients/${patientId}/episodes/${episodeId}/evaluation`,
    ),
  upsert: (patientId: string, episodeId: string, data: EvaluationUpsertData) =>
    api.put<InitialEvaluation>(
      `/api/patients/${patientId}/episodes/${episodeId}/evaluation`,
      data,
    ),
};
