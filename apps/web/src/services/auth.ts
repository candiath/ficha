import { api } from '@/lib/api';
import type {
  AuthSessionDTO,
  AuthUser,
  LoginResponse,
  PasswordResetTarget,
  RevokeOtherAuthSessionsResponse,
} from '@ficha/shared';

export const authApi = {
  // trustDevice: "Mantener la sesión iniciada en este dispositivo".
  login: (email: string, password: string, trustDevice = false) =>
    api.post<LoginResponse>('/api/auth/login', { email, password, trustDevice }),
  me: () => api.get<AuthUser>('/api/auth/me'),
  // Revokes this session on the server (204).
  logout: () => api.post<void>('/api/auth/logout', {}),
  // 204: the current session survives the change; every other one is revoked.
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>('/api/auth/change-password', {
      currentPassword,
      newPassword,
    }),
};

// Public: whoever holds a reset link (SPEC-password-reset). The token goes
// only in the body, never in a URL the API would log.
export const passwordResetApi = {
  check: (token: string) =>
    api.post<PasswordResetTarget>('/api/auth/password-reset/check', { token }),
  reset: (token: string, newPassword: string) =>
    api.post<void>('/api/auth/password-reset', { token, newPassword }),
};

// The user's own login sessions, shown as "dispositivos" (never "sesiones":
// that word is the clinical one).
export const authSessionKeys = {
  list: ['auth-sessions'] as const,
};

export const authSessionApi = {
  list: () => api.get<AuthSessionDTO[]>('/api/auth/devices'),
  close: (id: string) => api.delete(`/api/auth/devices/${id}`),
  closeOthers: () =>
    api.post<RevokeOtherAuthSessionsResponse>('/api/auth/devices/revoke-others', {}),
  untrust: (id: string) => api.post<void>(`/api/auth/devices/${id}/untrust`, {}),
};
