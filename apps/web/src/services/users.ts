import { api } from '@/lib/api';
import type { CreateUserInput, TenantUser, UpdateUserInput } from '@ficha/shared';

export const userKeys = {
  list: ['users'] as const,
};

// Gestión de usuarios de la clínica. Toda la ruta es solo ADMIN: a un
// THERAPIST la API le responde 403, así que la UI no la muestra.
export const usersApi = {
  list: () => api.get<TenantUser[]>('/api/users'),
  create: (data: CreateUserInput) => api.post<TenantUser>('/api/users', data),
  update: (id: string, data: UpdateUserInput) =>
    api.patch<TenantUser>(`/api/users/${id}`, data),
};
