// Tipos e interfaces compartidos entre apps/api y apps/web.
// Prisma vive exclusivamente en apps/api. Lo que se exporta aquí son
// las interfaces planas que la API expone en sus responses al cliente.
//
// A medida que construyas la app, agregá los tipos acá. Ejemplo:
// export type { Patient } from './types/patient';
// export type { Session } from './types/session';

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

// ── Evaluación inicial ───────────────────────────────────────────────────────

// A diferencia del resto del paquete, esto no son solo tipos: exporta la
// definición de la grilla de posturas y sus schemas de Zod, que la web usa para
// dibujar y la API para validar. Es el único módulo con valores de runtime.
export * from './postureFamilies';

// ── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'THERAPIST';

// Usuario tal como lo expone la API (sin passwordHash ni tenantId:
// el tenant es un detalle interno que el cliente nunca necesita).
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

// Respuesta de POST /api/auth/login.
export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// Payload de POST /api/auth/change-password.
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

// Respuesta de POST /api/auth/change-password. Devuelve un token nuevo
// porque el cambio de contraseña invalida todos los tokens anteriores:
// sin éste, la propia sesión que hizo el cambio quedaría afuera.
export interface ChangePasswordResponse {
  token: string;
}

// ── Gestión de usuarios (solo ADMIN) ─────────────────────────────────────────

// Usuario del tenant como lo expone GET /api/users: AuthUser más los campos
// administrativos que un ADMIN necesita ver.
export interface TenantUser extends AuthUser {
  isActive: boolean;
  lastLoginAt: string | null;
}

// Payload de POST /api/users.
export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
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
