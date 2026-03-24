import { api } from '@/lib/api';
import type { GlobalSession } from '@/types/globalSession';

export const globalSessionKeys = {
  all: ['sessions'] as const,
};

export const globalSessionApi = {
  list: () => api.get<GlobalSession[]>('/api/sessions'),
};
