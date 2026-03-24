import { api } from '@/lib/api';
import type { Session, SessionCreateData, SessionUpdateData } from '@/types/session';

export const sessionKeys = {
  list: (patientId: string) => ['patients', patientId, 'sessions'] as const,
  detail: (patientId: string, sessionId: string) =>
    ['patients', patientId, 'sessions', sessionId] as const,
};

export const sessionApi = {
  list: (patientId: string) =>
    api.get<Session[]>(`/api/patients/${patientId}/sessions`),
  get: (patientId: string, sessionId: string) =>
    api.get<Session>(`/api/patients/${patientId}/sessions/${sessionId}`),
  create: (patientId: string, data: SessionCreateData) =>
    api.post<Session>(`/api/patients/${patientId}/sessions`, data),
  update: (patientId: string, sessionId: string, data: SessionUpdateData) =>
    api.patch<Session>(`/api/patients/${patientId}/sessions/${sessionId}`, data),
};
