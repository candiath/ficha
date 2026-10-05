import { api } from '@/lib/api';
import type { AuthUser, LoginResponse } from '@ficha/shared';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }),
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
