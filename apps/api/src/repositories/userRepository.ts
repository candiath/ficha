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

// Generating a password reset link (SPEC-password-reset). The disabled
// password hash arrives computed, like passwordHash above: bcrypt is the
// route's business (lib/passwordReset.ts). ip and userAgent are those of
// whoever generates the link: evidence for the audit (#186).
export interface PasswordResetIssueInput {
  disabledPasswordHash: string;
  ip: string | null;
  userAgent: string | null;
}

// The raw token leaves the API only in this response, once.
export interface PasswordResetLink {
  token: string;
  expiresAt: string;
}

export type PasswordResetIssueResult =
  | ({ ok: true } & PasswordResetLink)
  | { ok: false; reason: 'not_found' | 'inactive' };

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
  /**
   * Revokes every open AuthSession of the user (SPEC-admin-revocation):
   * she keeps her account and logs in again. `not_found` if she does not
   * exist or belongs to another clinic. Returns no count on purpose: how
   * many devices she had is her own business.
   */
  disconnectDevices(ctx: TenantContext, id: string): Promise<'disconnected' | 'not_found'>;
  /**
   * Generates a single-use reset link for a user of the clinic; from that
   * moment her sessions and her current password stop working. `not_found`
   * if she does not exist or is in another clinic; `inactive` if she is
   * deactivated (nothing changes).
   */
  createPasswordReset(
    ctx: TenantContext,
    id: string,
    input: PasswordResetIssueInput,
  ): Promise<PasswordResetIssueResult>;
}
