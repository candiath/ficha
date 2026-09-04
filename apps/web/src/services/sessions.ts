import { api } from '@/lib/api';
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
  // Borrado lógico: la sesión desaparece de los listados y de las métricas,
  // pero la fila queda. Responde 409 si la sesión ya tiene un cobro pagado.
  remove: (patientId: string, sessionId: string) =>
    api.delete(`/api/patients/${patientId}/sessions/${sessionId}`),
};
