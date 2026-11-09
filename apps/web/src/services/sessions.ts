import { api } from '@/lib/api';
import type { AnnulData } from '@/types/patient';
import type { Session, SessionCreateData, SessionUpdateData } from '@/types/session';

export const sessionKeys = {
  list: (patientId: string, episodeId?: string) =>
    episodeId
      ? (['patients', patientId, 'episodes', episodeId, 'sessions'] as const)
      : (['patients', patientId, 'sessions'] as const),
  detail: (patientId: string, sessionId: string) =>
    ['patients', patientId, 'sessions', sessionId] as const,
};

export const sessionApi = {
  list: (patientId: string, episodeId?: string) => {
    const url = episodeId
      ? `/api/patients/${patientId}/sessions?episodeId=${episodeId}`
      : `/api/patients/${patientId}/sessions`;
    return api.get<Session[]>(url);
  },
  get: (patientId: string, sessionId: string) =>
    api.get<Session>(`/api/patients/${patientId}/sessions/${sessionId}`),
  create: (patientId: string, data: SessionCreateData) =>
    api.post<Session>(`/api/patients/${patientId}/sessions`, data),
  update: (patientId: string, sessionId: string, data: SessionUpdateData) =>
    api.patch<Session>(`/api/patients/${patientId}/sessions/${sessionId}`, data),
  // Annulled, never deleted (SPEC-clinical-revisions.md §8): it stays in the
  // record struck through and leaves the lists and the metrics. 409 if the
  // session has a paid payment.
  annul: (patientId: string, sessionId: string, data: AnnulData) =>
    api.post<void>(`/api/patients/${patientId}/sessions/${sessionId}/annul`, data),
};
