import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Los límites de la ventana llegan calculados: la política de meses UTC (y su
// limitación conocida de timezone) es presentación y vive en la ruta.
export interface DashboardStatsParams {
  /** Inicio del mes actual (UTC). */
  monthStart: Date;
  /** Inicio del mes siguiente (UTC), exclusivo. */
  nextMonthStart: Date;
  /** Inicio de la ventana del gráfico de sesiones por mes. */
  chartWindowStart: Date;
  /** Cuántos motivos de consulta devuelve el donut de patologías. */
  pathologiesTop: number;
}

export interface DashboardCounts {
  /** Pacientes vigentes con al menos un episodio clínico abierto. */
  activePatients: number;
  totalSessions: number;
  sessionsThisMonth: number;
  pendingPayments: number;
  /** Motivos de consulta más frecuentes, ya ordenados y recortados. */
  pathologies: { name: string; count: number }[];
  /** Fechas de las sesiones clínicas de la ventana, para agregar por mes. */
  sessionDates: Date[];
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Las notas rápidas (sessionType NOTE) no son sesiones clínicas: quedan fuera
// de todos los conteos. Esa regla vive en la implementación, una sola vez.
export interface DashboardRepository {
  getStats(ctx: TenantContext, params: DashboardStatsParams): Promise<DashboardCounts>;
}
