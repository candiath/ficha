import { api } from '@/lib/api';
import type { ClinicalEpisode, EpisodeCreateData, EpisodeUpdateData } from '@/types/episode';

export const episodeKeys = {
  list: (patientId: string) => ['patients', patientId, 'episodes'] as const,
};

export const episodeApi = {
  list: (patientId: string) =>
    api.get<ClinicalEpisode[]>(`/api/patients/${patientId}/episodes`),

  create: (patientId: string, data: EpisodeCreateData) =>
    api.post<ClinicalEpisode>(`/api/patients/${patientId}/episodes`, data),

  update: (patientId: string, episodeId: string, data: EpisodeUpdateData) =>
    api.patch<ClinicalEpisode>(`/api/patients/${patientId}/episodes/${episodeId}`, data),
};
