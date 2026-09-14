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

// Lo que se puede cambiar de un usuario después del alta. El email no: es la
// identidad de la cuenta, y la contraseña la cambia cada quien la suya.
export interface UserUpdateInput {
  role?: UserRole;
  isActive?: boolean;
}

// Tres salidas, así que resultado discriminado y no null: la ruta necesita
// distinguir "no existe" (404) de "existe pero es la última ADMIN activa"
// (409), y las dos son un no-cambio.
export type UserUpdateResult =
  | { ok: true; user: TenantUserDTO }
  | { ok: false; reason: 'not_found' | 'last_admin' };

// ─── Port ────────────────────────────────────────────────────────────────────

export interface UserRepository {
  /** Usuarios de la clínica, activos e inactivos, por fecha de alta. */
  list(ctx: TenantContext): Promise<TenantUserDTO[]>;
  /** null si ya existe un usuario con ese email (unique global). */
  create(ctx: TenantContext, input: UserCreateInput): Promise<TenantUserDTO | null>;
  /**
   * Cambia rol y/o estado. `not_found` si el usuario no existe o es de otra
   * clínica; `last_admin` si el cambio dejaría a la clínica sin una ADMIN
   * activa (ver whereConservaAdmin).
   */
  update(ctx: TenantContext, id: string, input: UserUpdateInput): Promise<UserUpdateResult>;
}
