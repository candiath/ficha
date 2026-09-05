import { api } from '@/lib/api';
import type { TenantConfig, TenantConfigInput } from '@ficha/shared';

export const tenantKeys = {
  config: ['tenant'] as const,
};

export const tenantApi = {
  get: () => api.get<TenantConfig>('/api/tenant'),
  // Solo ADMIN: la API responde 403 a un THERAPIST.
  update: (data: TenantConfigInput) => api.patch<TenantConfig>('/api/tenant', data),
};
