import { api } from '@/lib/api';
import type { SessionIndexItem } from '@/types/globalSession';

export const globalSessionKeys = {
  all: ['sessions'] as const,
};

export const globalSessionApi = {
  // An index with no clinical text: the session is read with sessionApi.get.
  list: () => api.get<SessionIndexItem[]>('/api/sessions'),
};
