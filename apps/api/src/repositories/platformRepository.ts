import type { PlatformAction } from '@prisma/client';
import type { OperatorContext } from './types';
import type { TenantUserDTO, UserUpdateInput, UserUpdateResult } from './userRepository';

// Repositorio del operador de plataforma (issue #153). Es la tercera
// excepción documentada a "ctx: TenantContext primero", y la más deliberada:
// acá NO hay tenant del cual scopear porque el operador es justamente quien
// elige el tenant. Por eso toda operación sobre una clínica recibe el
// `tenantId` como argumento explícito — ésa es la señal en el código de que
// esta capa es la única que lo decide a mano.
//
// Lo que toca: platform_operators, tenants, users (solo lo administrativo:
// email, nombre, rol, estado) y platform_audit_logs. Nunca un join a nada
// clínico. Si alguna vez un método de acá necesita pacientes, sesiones o
// cobros, la respuesta es que ese método no va acá.

// ─── Operadores ──────────────────────────────────────────────────────────────

export interface OperatorProfile {
  id: string;
  email: string;
  name: string | null;
}

// Para el login: incluye passwordHash e isActive, como LoginUser.
export interface OperatorLogin extends OperatorProfile {
  passwordHash: string;
  isActive: boolean;
}

// Para authenticateOperator: lo justo para armar req.operator y validar el
// token contra passwordChangedAt.
export interface OperatorAuth {
  id: string;
  passwordChangedAt: Date | null;
}

export interface OperatorCredentials {
  id: string;
  passwordHash: string;
}

// ─── Clínicas ────────────────────────────────────────────────────────────────

export interface PlatformTenantDTO {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  deactivatedAt: string | null;
  // Cuántas ADMIN activas tiene: una clínica con cero es la que necesita al
  // operador, y es el único número que hace falta para verlo en la lista.
  activeAdmins: number;
}

export interface PlatformTenantCreateInput {
  name: string;
  slug: string;
}

// ─── Usuarios de una clínica ─────────────────────────────────────────────────

// La misma vista administrativa que ve una ADMIN de la clínica: nada más.
export type PlatformUserDTO = TenantUserDTO;

export interface PlatformAdminCreateInput {
  email: string;
  name: string;
  passwordHash: string;
}

export type PlatformAdminCreateResult =
  | { ok: true; user: PlatformUserDTO }
  | { ok: false; reason: 'tenant_not_found' | 'email_taken' };

// ─── Auditoría ───────────────────────────────────────────────────────────────

export interface PlatformAuditLogDTO {
  id: string;
  operatorId: string | null;
  tenantId: string;
  targetUserId: string | null;
  action: PlatformAction;
  description: string;
  createdAt: string;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Cada escritura registra su fila de auditoría en la misma transacción: por
// construcción no puede existir una acción del operador sin rastro. Por eso
// las escrituras reciben el OperatorContext y no hay un `recordAudit`
// suelto que una ruta pueda olvidarse de llamar.
export interface PlatformRepository {
  /** Para el login. Incluye inactivos: la ruta decide el mensaje único. */
  findOperatorByEmailForLogin(email: string): Promise<OperatorLogin | null>;
  /** Para authenticateOperator: solo operadores activos. */
  findOperatorForAuth(id: string): Promise<OperatorAuth | null>;
  getOperatorProfile(id: string): Promise<OperatorProfile | null>;
  getOperatorCredentials(id: string): Promise<OperatorCredentials | null>;
  touchOperatorLastLogin(id: string): Promise<void>;
  /** Cambia el hash y estampa passwordChangedAt (invalida tokens previos). */
  updateOperatorPassword(id: string, passwordHash: string): Promise<void>;

  /** Todas las clínicas, activas y desactivadas, por fecha de alta. */
  listTenants(): Promise<PlatformTenantDTO[]>;
  /** null si el slug ya existe. */
  createTenant(op: OperatorContext, input: PlatformTenantCreateInput): Promise<PlatformTenantDTO | null>;
  /**
   * Desactiva o reactiva una clínica entera. null si no existe. Idempotente:
   * desactivar una ya desactivada no cambia la marca ni deja auditoría.
   */
  setTenantActive(op: OperatorContext, tenantId: string, active: boolean): Promise<PlatformTenantDTO | null>;

  /** Usuarios de la clínica, activos e inactivos. null si la clínica no existe. */
  listTenantUsers(tenantId: string): Promise<PlatformUserDTO[] | null>;
  /** Crea un ADMIN en la clínica. El rol lo fija el repositorio: no se elige. */
  createAdmin(op: OperatorContext, tenantId: string, input: PlatformAdminCreateInput): Promise<PlatformAdminCreateResult>;
  /**
   * Cambia rol y/o estado de un usuario de la clínica, con la misma regla
   * de "la clínica conserva una ADMIN activa" que userRepository.update.
   * `not_found` cubre clínica inexistente y usuario que no es de ella.
   */
  updateTenantUser(op: OperatorContext, tenantId: string, userId: string, input: UserUpdateInput): Promise<UserUpdateResult>;

  /** Acciones sobre una clínica, de la más reciente a la más vieja. */
  listAuditLog(tenantId: string): Promise<PlatformAuditLogDTO[]>;
}
