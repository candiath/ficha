import { api } from '@/lib/api';
import type { AuthUser, ChangePasswordResponse, LoginResponse } from '@ficha/shared';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }),
  me: () => api.get<AuthUser>('/api/auth/me'),
  // Devuelve un token nuevo: el cambio invalida todos los anteriores.
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<ChangePasswordResponse>('/api/auth/change-password', {
      currentPassword,
      newPassword,
    }),
};
