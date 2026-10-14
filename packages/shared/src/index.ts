// Tipos e interfaces compartidos entre apps/api y apps/web.
// Prisma vive exclusivamente en apps/api. Lo que se exporta aquí son
// las interfaces planas que la API expone en sus responses al cliente.
//
// A medida que construyas la app, agregá los tipos acá. Ejemplo:
// export type { Patient } from './types/patient';
// export type { Session } from './types/session';

import type { PlatformAction } from './auditActions';

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

// ── Slug de clínica ──────────────────────────────────────────────────────────

// A diferencia del resto del paquete, esto no son solo tipos: la API deriva el
// slug con esto y la web muestra el mismo resultado antes de mandar. Una sola
// implementación, o divergen.
export * from './slug';

// ── Auditoría ────────────────────────────────────────────────────────────────

// Runtime as well: the catalog of audit actions (#186,
// SPEC-audit-structured-entries.md). The API validates every audit row with
// it, and the web builds each row's sentence from it.
export * from './auditActions';

// ── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'THERAPIST';

// La clínica a la que pertenece el usuario, tal como se muestra en la app.
// Solo su identidad: el id del tenant sigue siendo un detalle interno que el
// cliente nunca necesita (viaja en el token y se resuelve server-side).
export interface AuthTenant {
  name: string;
  slug: string;
}

// Usuario tal como lo expone la API (sin passwordHash ni tenantId).
// Incluye la clínica porque "quién soy" en una app multi-tenant también
// responde "en qué clínica estoy": la pantalla de Clínica lo lee de acá en
// vez de tener los datos escritos a mano.
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenant: AuthTenant;
}

// ── Configuración de la clínica ──────────────────────────────────────────────

// Lo que devuelve GET /api/tenant. Sin id (el cliente ya sabe en qué clínica
// está) y sin el slug editable: es un identificador, no un dato de contacto.
export interface TenantConfig extends AuthTenant {
  email: string | null;
  phone: string | null;
  address: string | null;
  cuit: string | null;
  specialty: string | null;
  /** Identificador IANA, p. ej. "America/Argentina/Buenos_Aires". */
  timezone: string;
  /** "HH:mm" en hora local de la clínica. */
  workdayStart: string;
  workdayEnd: string;
  /** Días laborables con la convención de Date#getDay(): 0 domingo … 6 sábado. */
  workdays: number[];
}

// Payload de PATCH /api/tenant (solo ADMIN). Todo opcional: es un PATCH.
export type TenantConfigInput = Partial<Omit<TenantConfig, 'slug'>>;

// Respuesta de POST /api/auth/login.
export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// One of the user's active sessions, as GET /api/auth/devices lists them
// (docs/specs/SPEC-my-sessions.md). Only the user herself ever sees these.
export interface AuthSessionDTO {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  // "Mantener la sesión iniciada en este dispositivo".
  trusted: boolean;
  ip: string | null;
  // Raw User-Agent; the web turns it into "Chrome en Windows" and the like.
  userAgent: string | null;
  // The session making this request.
  current: boolean;
}

// POST /api/auth/devices/revoke-others.
export interface RevokeOtherAuthSessionsResponse {
  revoked: number;
}

// Payload de POST /api/auth/change-password.
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// Response of POST /api/platform/auth/change-password. The operator is still
// on a JWT: the change invalidates every earlier token, so a new one comes
// back. The clinic endpoint answers 204 instead (its session survives).
export interface ChangePasswordResponse {
  token: string;
}

// ── Gestión de usuarios (solo ADMIN) ─────────────────────────────────────────

// A freshly generated password reset link (POST /api/users/:id/password-reset
// and its platform counterpart). The raw token is in this response only.
export interface PasswordResetLink {
  token: string;
  expiresAt: string;
}

// Public reset page: whose account a valid link resets.
export interface PasswordResetTarget {
  email: string;
  name: string | null;
}

// Usuario del tenant como lo expone GET /api/users: la identidad de AuthUser
// más los campos administrativos que un ADMIN necesita ver. Sin `tenant`: la
// lista es de la propia clínica, y la API no lo manda.
export interface TenantUser extends Omit<AuthUser, 'tenant'> {
  isActive: boolean;
  lastLoginAt: string | null;
  // Expiry of her usable password reset link, or null: the
  // "Restablecimiento pendiente" badge.
  passwordResetExpiresAt: string | null;
}

// Payload de POST /api/users.
export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}

// Payload de PATCH /api/users/:id. Al menos uno de los dos; la API responde
// 400 a un body vacío y 409 si el cambio dejaría a la clínica sin una ADMIN
// activa.
export interface UpdateUserInput {
  role?: UserRole;
  isActive?: boolean;
}

// ── Dashboard ────────────────────────────────────────────────────────────────

// Un motivo de consulta (ClinicalEpisode.mainComplaint) con su frecuencia.
// Es texto libre: se agrupa por string exacto, sin normalizar.
export interface PathologyCount {
  name: string;
  count: number;
}

// Sesiones de un mes calendario. `month` viene como "YYYY-MM"; el label
// localizado (p. ej. "feb") lo arma el cliente, la API es agnóstica de locale.
export interface MonthSessionCount {
  month: string;
  count: number;
}

// Respuesta de GET /api/dashboard/stats. Las notas rápidas (sessionType NOTE)
// no cuentan como sesiones; "activo" = paciente con algún episodio ACTIVE.
export interface DashboardStats {
  activePatients: number;
  totalSessions: number;
  sessionsThisMonth: number;
  pendingPayments: number;
  pathologies: PathologyCount[];
  sessionsByMonth: MonthSessionCount[];
}

// ── Turnos ───────────────────────────────────────────────────────────────────

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/**
 * Un turno como lo devuelve la API.
 *
 * Trae el instante (`startsAt`/`endsAt`) Y la hora de pared de la clínica ya
 * resuelta (`date`/`startTime`/`endTime`). La redundancia es a propósito: el
 * cliente necesita saber en qué casilla de la grilla va cada turno, y hacer esa
 * conversión en el navegador significaría reimplementar la zona horaria de la
 * clínica ahí — con el detalle de que la zona del navegador puede no ser la
 * misma.
 */
// An appointment of the agenda's range (GET /api/appointments): no episode
// complaint and no notes, since the range spans patients (#186,
// SPEC-list-minimization.md §2). The complaint is read from the patient's
// episodes; the notes from the appointment itself.
export interface AppointmentListItem {
  id: string;
  patientId: string;
  patientName: string;
  userId: string;
  episodeId: string | null;
  /** La sesión que salió de este turno, si el paciente vino y se registró. */
  sessionId: string | null;
  /** Compartido por los turnos de una misma serie recurrente. */
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  /** Hora de pared de la clínica. */
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  cancelledAt: string | null;
}

// One appointment (GET /api/appointments/:id, and what a write returns).
export interface Appointment extends AppointmentListItem {
  notes: string | null;
}

export interface AppointmentCreateInput {
  patientId: string;
  episodeId?: string | null;
  notes?: string | null;
  date: string;
  time: string;
  durationMinutes: number;
  /** Si viene, se crean `occurrences` turnos que comparten un seriesId. */
  repeat?: { everyWeeks: number; occurrences: number };
}

export interface AppointmentUpdateInput {
  date?: string;
  time?: string;
  durationMinutes?: number;
  status?: AppointmentStatus;
  episodeId?: string | null;
  notes?: string | null;
}

// ── Operador de plataforma (/api/platform/*) ────────────────────────────────
//
// Otra sesión, otro token, otro cliente HTTP: nada de esto pasa por AuthUser
// ni por el AuthContext de la clínica. Ver issue #153.

export interface PlatformOperator {
  id: string;
  email: string;
  name: string | null;
}

export interface PlatformLoginResponse {
  token: string;
  operator: PlatformOperator;
}

// Una clínica vista por el operador: identidad, estado y cuántas ADMIN
// activas tiene. Nada de contacto ni horarios (son de la clínica) y por
// supuesto nada clínico.
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** null = activa. Desactivada, todos sus usuarios pierden el acceso. */
  deactivatedAt: string | null;
  activeAdmins: number;
}

export interface PlatformTenantCreateInput {
  name: string;
  /** Si falta, la API lo deriva del nombre. */
  slug?: string;
}

// Un usuario de una clínica visto por el operador: lo mismo que ve una ADMIN
// de esa clínica.
export type PlatformUser = TenantUser;

// El rol no se manda: el operador crea ADMIN, y punto.
export interface PlatformAdminCreateInput {
  email: string;
  name: string;
  password: string;
}

export interface PlatformAuditEntry {
  id: string;
  operatorId: string | null;
  // Null only for an action on the platform itself (TEST_ALERT_SENT), which a
  // clinic's list never returns.
  tenantId: string | null;
  targetUserId: string | null;
  // Resolved when the list is read: an audit row never names the person (#186).
  targetUser: { email: string; name: string | null } | null;
  action: PlatformAction;
  // Codes only (#186): read with readAuditParams / describeAuditEntry.
  params: Record<string, unknown>;
  createdAt: string;
}

// ── Sysadmin alerts (/api/platform/alerts) ──────────────────────────────────
//
// What the operator is told by Telegram, and whether it reached her (#186,
// docs/specs/SPEC-sysadmin-alerts.md). The card shows the configuration by
// status and variable names only: never the token or the chat id.

export type SysadminAlertKind = 'AUDIT_GUARDS_FAILED' | 'AUDIT_MAINTENANCE_FLAG_PRESENT' | 'TEST';

export type SysadminAlertOutcome = 'SENT' | 'REJECTED' | 'UNREACHABLE' | 'NOT_CONFIGURED';

export interface SysadminAlertDelivery {
  outcome: SysadminAlertOutcome;
  /** Telegram's error_code, only when it rejected the message. */
  errorCode: number | null;
  /** Telegram's description, the network error's code, or the variables' names. */
  detail: string | null;
  createdAt: string;
}

export interface SysadminAlert {
  id: string;
  kind: SysadminAlertKind;
  createdAt: string;
  /** How many delivery attempts it took; the latest is lastDelivery. */
  deliveries: number;
  lastDelivery: SysadminAlertDelivery | null;
}

export interface SysadminAlertsOverview {
  /** The label every message starts with: the Render service's name, or "local". */
  environment: string;
  configuration: 'configured' | 'not_configured' | 'invalid';
  /** The names of the missing or malformed variables. */
  variables: string[];
  /** The last 20 real alerts (tests apart), newest first. */
  alerts: SysadminAlert[];
  lastTest: SysadminAlert | null;
  /** The latest attempt of any alert. */
  lastDelivery: (SysadminAlertDelivery & { alertId: string; kind: SysadminAlertKind }) | null;
  /** The most recent real alert, while it has not been delivered: the banner. */
  undeliveredAlert: SysadminAlert | null;
}

export type SysadminAlertBot =
  | { status: 'ok'; username: string }
  | { status: 'not_configured' }
  | { status: 'error'; errorCode: number | null; detail: string | null };

export interface TestAlertResult {
  alertId: string;
  outcome: SysadminAlertOutcome;
  errorCode: number | null;
  detail: string | null;
}
