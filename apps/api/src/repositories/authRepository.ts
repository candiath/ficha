import type { UserRole } from '@prisma/client';

// Repositorio PRE-TENANT: acá no hay TenantContext porque estas lecturas son
// las que lo CONSTRUYEN — login y authenticate corren antes de conocer el
// tenant. Es la única excepción a la regla "ctx primer argumento", y vive en
// un repo aparte de userRepository justamente para que la excepción quede
// a la vista y no se imite en repos de dominio.

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Para el login: incluye passwordHash (la ruta hace el bcrypt.compare) e
// isActive (la ruta decide el mensaje único que no revela cuál falló).
// La clínica del usuario. Se devuelve junto al perfil porque la app la
// muestra (pantalla Clínica); el id del tenant no va: es interno.
export interface TenantIdentity {
  name: string;
  slug: string;
}

export interface LoginUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenant: TenantIdentity;
  tenantId: string;
  passwordHash: string;
  isActive: boolean;
  // false si el operador de plataforma desactivó la clínica entera. Para el
  // login vale lo mismo que un usuario inactivo: el mismo 401 genérico.
  tenantActive: boolean;
}

// What authenticate needs from a valid session: enough to build req.context,
// plus the session id for the routes that act on the current session.
export interface SessionAuth {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: UserRole;
}

export interface CreateSessionInput {
  userId: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface PublicProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenant: TenantIdentity;
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
  // Solo en el login del operador de plataforma; omitido en el de la clínica.
  operatorId?: string | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
}

// Lo justo para decidir si una cuenta está frenada: la ruta mira si los
// últimos intentos fueron todos fallidos.
export interface LoginAttempt {
  success: boolean;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AuthRepository {
  /** Para el login. Incluye inactivos: la ruta decide el mensaje único. */
  findByEmailForLogin(email: string): Promise<LoginUser | null>;
  /**
   * Opens a session and returns its raw token. The token leaves this method
   * once, for the login response; only its hash is stored.
   */
  createSession(input: CreateSessionInput): Promise<{ token: string }>;
  /**
   * For authenticate: the session behind a raw token, or null. One query
   * decides everything — session unrevoked and unexpired, user active, clinic
   * active — so no route can forget one of the conditions.
   */
  findSessionForAuth(token: string): Promise<SessionAuth | null>;
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
  /**
   * Los últimos `limit` intentos contra un email posteriores a `since`, del
   * más reciente al más viejo. Sirve al freno por cuenta del login: cuenta
   * por email y no por usuario a propósito, así un email que no existe se
   * frena igual que uno real.
   */
  recentLoginAttempts(email: string, since: Date, limit: number): Promise<LoginAttempt[]>;
}
