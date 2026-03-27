import { api } from '@/lib/api';
import type { SessionTechnique, SessionTechniqueCreateEntry } from '@/types/sessionTechnique';

export const sessionTechniqueKeys = {
  list: (patientId: string, sessionId: string) =>
    ['patients', patientId, 'sessions', sessionId, 'techniques'] as const,
};

export const sessionTechniqueApi = {
  list: (patientId: string, sessionId: string) =>
    api.get<SessionTechnique[]>(
      `/api/patients/${patientId}/sessions/${sessionId}/techniques`,
    ),
  bulkReplace: (patientId: string, sessionId: string, entries: SessionTechniqueCreateEntry[]) =>
    api.put<SessionTechnique[]>(
      `/api/patients/${patientId}/sessions/${sessionId}/techniques`,
      { entries },
    ),
};
