import { api } from '@/lib/api';
import type { Technique } from '@/types/technique';

export const techniqueKeys = {
  all: ['techniques'] as const,
};

export const techniqueApi = {
  list: () => api.get<Technique[]>('/api/techniques'),
  create: (name: string) => api.post<Technique>('/api/techniques', { name }),
  update: (id: string, name: string) => api.patch<Technique>(`/api/techniques/${id}`, { name }),
  remove: (id: string) => api.delete(`/api/techniques/${id}`),
};
