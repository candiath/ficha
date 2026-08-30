import type { UserRole } from '@prisma/client';

// Repositorio PRE-TENANT: acá no hay TenantContext porque estas lecturas son
// las que lo CONSTRUYEN — login y authenticate corren antes de conocer el
// tenant. Es la única excepción a la regla "ctx primer argumento", y vive en
// un repo aparte de userRepository justamente para que la excepción quede
// a la vista y no se imite en repos de dominio.

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Para el login: incluye passwordHash (la ruta hace el bcrypt.compare) e
// isActive (la ruta decide el mensaje único que no revela cuál falló).
export interface LoginUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string;
  passwordHash: string;
  isActive: boolean;
}

// Para authenticate: lo justo para armar req.context y validar el token.
// passwordChangedAt queda como Date (se compara contra el iat en segundos).
export interface AuthUser {
  id: string;
  tenantId: string;
  role: UserRole;
  passwordChangedAt: Date | null;
}

export interface PublicProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export interface Credentials {
  id: string;
  tenantId: string;
  passwordHash: string;
}

export interface LoginEventInput {
  email: string;
  tenantId: string | null;
  userId: string | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AuthRepository {
  /** Para el login. Incluye inactivos: la ruta decide el mensaje único. */
  findByEmailForLogin(email: string): Promise<LoginUser | null>;
  /** Para authenticate: solo usuarios activos (null revoca el acceso). */
  findForAuth(userId: string): Promise<AuthUser | null>;
  /** Perfil público para /me. */
  getPublicProfile(userId: string): Promise<PublicProfile | null>;
  /** Credenciales para change-password (única salida extra del hash). */
  getCredentials(userId: string): Promise<Credentials | null>;
  /** Registra el último acceso exitoso. */
  touchLastLogin(userId: string): Promise<void>;
  /** Cambia el hash y estampa passwordChangedAt (invalida tokens previos). */
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  /** Telemetría de seguridad: cada intento de login, exitoso o no. */
  recordLoginEvent(input: LoginEventInput): Promise<void>;
}
