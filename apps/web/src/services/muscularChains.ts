import { api } from '@/lib/api';
import type { MuscularChain } from '@/types/muscularChain';

export const muscularChainKeys = {
  all: ['muscular-chains'] as const,
};

export const muscularChainApi = {
  list: () => api.get<MuscularChain[]>('/api/muscular-chains'),
};
