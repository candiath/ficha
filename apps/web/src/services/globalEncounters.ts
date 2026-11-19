import { api } from '@/lib/api';
import type { EncounterIndexItem } from '@/types/globalEncounter';

export const globalEncounterKeys = {
  all: ['encounters'] as const,
};

export const globalEncounterApi = {
  // An index with no clinical text: the encounter is read with encounterApi.get.
  list: () => api.get<EncounterIndexItem[]>('/api/encounters'),
};
