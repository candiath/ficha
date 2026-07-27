import { api } from '@/lib/api';
import type { DashboardStats } from '@ficha/shared';

export const dashboardKeys = {
  stats: ['dashboard', 'stats'] as const,
};

export const dashboardApi = {
  getStats: () => api.get<DashboardStats>('/api/dashboard/stats'),
};
