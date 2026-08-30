import type { UserRole } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Lo que un ADMIN ve de los usuarios de su clínica. passwordHash y tenantId
// nunca salen de la API (mismo criterio que el perfil público de auth).
export interface TenantUserDTO {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
}

// El hash llega ya calculado: el costo de bcrypt es una decisión de la ruta
// (capa HTTP), no de persistencia.
export interface UserCreateInput {
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface UserRepository {
  /** Usuarios de la clínica, activos e inactivos, por fecha de alta. */
  list(ctx: TenantContext): Promise<TenantUserDTO[]>;
  /** null si ya existe un usuario con ese email (unique global). */
  create(ctx: TenantContext, input: UserCreateInput): Promise<TenantUserDTO | null>;
  /** null si el usuario no existe o es de otra clínica. */
  setActive(ctx: TenantContext, id: string, isActive: boolean): Promise<TenantUserDTO | null>;
}
