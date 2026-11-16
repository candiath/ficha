import { api } from '@/lib/api';
import type { AnnulData } from '@/types/patient';
import type { Encounter, EncounterCreateData, EncounterUpdateData } from '@/types/encounter';

export const encounterKeys = {
  list: (patientId: string, episodeId?: string) =>
    episodeId
      ? (['patients', patientId, 'episodes', episodeId, 'encounters'] as const)
      : (['patients', patientId, 'encounters'] as const),
  detail: (patientId: string, encounterId: string) =>
    ['patients', patientId, 'encounters', encounterId] as const,
};

export const encounterApi = {
  list: (patientId: string, episodeId?: string) => {
    const url = episodeId
      ? `/api/patients/${patientId}/encounters?episodeId=${episodeId}`
      : `/api/patients/${patientId}/encounters`;
    return api.get<Encounter[]>(url);
  },
  get: (patientId: string, encounterId: string) =>
    api.get<Encounter>(`/api/patients/${patientId}/encounters/${encounterId}`),
  create: (patientId: string, data: EncounterCreateData) =>
    api.post<Encounter>(`/api/patients/${patientId}/encounters`, data),
  update: (patientId: string, encounterId: string, data: EncounterUpdateData) =>
    api.patch<Encounter>(`/api/patients/${patientId}/encounters/${encounterId}`, data),
  // Annulled, never deleted (SPEC-clinical-revisions.md §8): it stays in the
  // record struck through and leaves the lists and the metrics. 409 if the
  // encounter has a paid payment.
  annul: (patientId: string, encounterId: string, data: AnnulData) =>
    api.post<void>(`/api/patients/${patientId}/encounters/${encounterId}/annul`, data),
};
