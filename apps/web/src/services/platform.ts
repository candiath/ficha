import { platformApi } from '@/lib/api';
import type {
  PlatformAdminCreateInput,
  PlatformAuditEntry,
  PlatformLoginResponse,
  PlatformOperator,
  PlatformTenant,
  PlatformTenantCreateInput,
  PlatformUser,
  UpdateUserInput,
} from '@ficha/shared';

// Todo por platformApi, nunca por `api`: es otra sesión con otro token.

export const platformKeys = {
  tenants: ['platform', 'tenants'] as const,
  users: (tenantId: string) => ['platform', 'tenants', tenantId, 'users'] as const,
  audit: (tenantId: string) => ['platform', 'tenants', tenantId, 'audit'] as const,
};

export const platformAuthApi = {
  login: (email: string, password: string) =>
    platformApi.post<PlatformLoginResponse>('/api/platform/auth/login', { email, password }),
  me: () => platformApi.get<PlatformOperator>('/api/platform/auth/me'),
};

export const platformTenantsApi = {
  list: () => platformApi.get<PlatformTenant[]>('/api/platform/tenants'),
  create: (data: PlatformTenantCreateInput) =>
    platformApi.post<PlatformTenant>('/api/platform/tenants', data),
  setActive: (tenantId: string, active: boolean) =>
    platformApi.patch<PlatformTenant>(`/api/platform/tenants/${tenantId}`, { active }),
  users: (tenantId: string) =>
    platformApi.get<PlatformUser[]>(`/api/platform/tenants/${tenantId}/users`),
  createAdmin: (tenantId: string, data: PlatformAdminCreateInput) =>
    platformApi.post<PlatformUser>(`/api/platform/tenants/${tenantId}/users`, data),
  updateUser: (tenantId: string, userId: string, data: UpdateUserInput) =>
    platformApi.patch<PlatformUser>(`/api/platform/tenants/${tenantId}/users/${userId}`, data),
  auditLog: (tenantId: string) =>
    platformApi.get<PlatformAuditEntry[]>(`/api/platform/tenants/${tenantId}/audit-log`),
};
