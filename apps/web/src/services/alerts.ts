import { api } from '@/lib/api';
import type { AlertStats, ClinicalAlert } from '@/types/alert';

export const alertKeys = {
  all: ['alerts'] as const,
  list: (filters?: { type?: string; isRead?: string }) =>
    ['alerts', filters] as const,
  stats: ['alerts', 'stats'] as const,
};

export const alertApi = {
  list: (params?: { type?: string; isRead?: string }) => {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.isRead) query.set('isRead', params.isRead);
    const qs = query.toString();
    return api.get<ClinicalAlert[]>(`/api/alerts${qs ? `?${qs}` : ''}`);
  },
  stats: () => api.get<AlertStats>('/api/alerts/stats'),
  create: (data: { patientId: string; type: string; message: string }) =>
    api.post<ClinicalAlert>('/api/alerts', data),
  markAsRead: (id: string) =>
    api.patch<ClinicalAlert>(`/api/alerts/${id}/read`, {}),
  markAllAsRead: () =>
    api.patch<{ updated: number }>('/api/alerts/read-all', {}),
};
