import { api } from '@/lib/api';
import type { AuthUser, LoginResponse } from '@ficha/shared';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }),
  me: () => api.get<AuthUser>('/api/auth/me'),
};
