import { api } from '@/lib/api';
import type { Revision, RevisionSummary } from '@/types/revision';

// The history of each versioned record, under the patient's record
// (SPEC-clinical-revisions.md §7). A base is the record's path plus
// `/revisions`; every query key hangs from the patient.
export const revisionPaths = {
  patient: (patientId: string) => `/api/patients/${patientId}/revisions`,
  session: (patientId: string, sessionId: string) => `/api/patients/${patientId}/sessions/${sessionId}/revisions`,
  episode: (patientId: string, episodeId: string) => `/api/patients/${patientId}/episodes/${episodeId}/revisions`,
  evaluation: (patientId: string, episodeId: string) =>
    `/api/patients/${patientId}/episodes/${episodeId}/evaluation/revisions`,
  consent: (patientId: string) => `/api/patients/${patientId}/consent/revisions`,
  patientEvent: (patientId: string, eventId: string) => `/api/patients/${patientId}/events/${eventId}/revisions`,
};

export const revisionKeys = {
  list: (patientId: string, base: string) => ['patients', patientId, 'revisions', base] as const,
  one: (patientId: string, base: string, version: number) => ['patients', patientId, 'revisions', base, version] as const,
};

export const revisionApi = {
  list: (base: string) => api.get<RevisionSummary[]>(base),
  get: (base: string, version: number) => api.get<Revision>(`${base}/${version}`),
};
