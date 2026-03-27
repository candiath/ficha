import { api } from '@/lib/api';
import type { BodyRegion } from '@/types/bodyRegion';

export const bodyRegionKeys = {
  all: ['body-regions'] as const,
};

export const bodyRegionApi = {
  list: () => api.get<BodyRegion[]>('/api/body-regions'),
};
