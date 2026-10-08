import type { UserRole } from '@prisma/client';
import type { AuthSessionDTO } from '@ficha/shared';

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
export interface ValidAuthSession {
  authSessionId: string;
  userId: string;
  tenantId: string;
  role: UserRole;
  // For authenticate to decide whether last use is worth refreshing.
  lastUsedAt: Date;
}

// A session as the user's own list shows it; the route adds `current`.
export type AuthSessionSummary = Omit<AuthSessionDTO, 'current'>;

export interface CreateAuthSessionInput {
  userId: string;
  // Profile from lib/authSessionPolicy.ts; the expiry is derived from it.
  trusted: boolean;
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

// The public reset page shows whose account it is about to reset: whoever
// holds the link already controls the account, so this reveals nothing new.
export interface PasswordResetTarget {
  email: string;
  name: string | null;
}

// passwordHash arrives computed (bcrypt is the route's business); ip and
// userAgent are those of whoever uses the link: evidence for the audit (#186).
export interface PasswordResetUseInput {
  passwordHash: string;
  ip: string | null;
  userAgent: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface AuthRepository {
  /** Para el login. Incluye inactivos: la ruta decide el mensaje único. */
  findByEmailForLogin(email: string): Promise<LoginUser | null>;
  /**
   * Opens a session and returns its raw token. The token leaves this method
   * once, for the login response; only its hash is stored.
   */
  createAuthSession(input: CreateAuthSessionInput): Promise<{ token: string }>;
  /**
   * For authenticate: the session behind a raw token, or null. One query
   * decides everything — session unrevoked and unexpired, user active, clinic
   * active — so no route can forget one of the conditions.
   */
  findValidAuthSession(token: string): Promise<ValidAuthSession | null>;
  /** Revokes one session. false if it was already revoked or does not exist. */
  revokeAuthSession(authSessionId: string): Promise<boolean>;
  /** Marks the session as used now, unless it was within the throttle window. */
  touchAuthSession(authSessionId: string): Promise<void>;

  // ── The user's own sessions (my-sessions) ─────────────────────────────────
  // Scoped by an explicit userId in the same query that reads or writes:
  // auth_sessions has no tenantId, and the owner is the user. Someone else's
  // session id behaves exactly like a nonexistent one.

  /** Live sessions (not revoked, expired or idle), most recently used first; at most 50. */
  listAuthSessions(userId: string): Promise<AuthSessionSummary[]>;
  /** false if the session is not hers, does not exist or is already closed. */
  revokeUserAuthSession(userId: string, authSessionId: string): Promise<boolean>;
  /** Closes every live session of the user but one; returns how many. */
  revokeOtherAuthSessions(userId: string, keepSessionId: string): Promise<number>;
  /** Demotes one of her live trusted sessions to normal; false otherwise. */
  untrustUserAuthSession(userId: string, authSessionId: string): Promise<boolean>;
  /** Perfil público para /me. */
  getPublicProfile(userId: string): Promise<PublicProfile | null>;
  /** Credenciales para change-password (única salida extra del hash). */
  getCredentials(userId: string): Promise<Credentials | null>;
  /** Registra el último acceso exitoso. */
  touchLastLogin(userId: string): Promise<void>;
  /**
   * Sets the new hash and revokes every open session of the user except
   * `keepSessionId` (the one making the change), in one transaction.
   */
  changePassword(userId: string, passwordHash: string, keepSessionId: string): Promise<void>;

  // ── Password reset links (SPEC-password-reset) ────────────────────────────
  // A link is valid if it is unused, not invalidated and not expired, and its
  // user and her clinic are active: one `where`, shared by both methods.

  /** Whose account a valid link resets; null for any invalid link. */
  checkPasswordReset(token: string): Promise<PasswordResetTarget | null>;
  /**
   * Uses the link: sets the new hash, marks the link used (with the request's
   * IP and user agent), retires her other links and revokes her sessions, in
   * one transaction conditioned on the link still being valid. false if it is
   * not — including when a concurrent request used it first.
   */
  resetPassword(token: string, input: PasswordResetUseInput): Promise<boolean>;

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
