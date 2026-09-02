import { Router } from 'express';
import type { DashboardStats, MonthSessionCount } from '@ficha/shared';
import { dashboardRepo } from '../repositories';

// Las queries viven en dashboardRepo; acá queda la presentación: los límites
// de la ventana en meses UTC y la agregación del gráfico.
const router = Router();

// Meses que muestra el gráfico "Sesiones por mes" (incluye el mes actual).
const SESSIONS_BY_MONTH_WINDOW = 6;
// Cantidad de motivos de consulta del donut de patologías.
const PATHOLOGIES_TOP = 5;

// Los límites de mes se calculan en UTC, igual que se guarda sessionDate.
// Limitación conocida: no hay timezone por tenant, así que una sesión a las
// 22:00 de fin de mes en UTC-3 cae en el mes UTC siguiente. Se acepta el
// corrimiento a cambio de counts deterministas en cualquier entorno.
function utcMonthStart(base: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
}

// Formatea un instante como la clave "YYYY-MM" de su mes UTC.
function utcMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

// Agrupa fechas de sesión en los últimos SESSIONS_BY_MONTH_WINDOW meses,
// en orden cronológico y con count: 0 para los meses sin sesiones. Las fechas
// fuera de la ventana (p. ej. una sesión cargada a futuro en el mes que viene)
// se ignoran: el gráfico solo pinta la ventana.
function aggregateSessionsByMonth(
  dates: Date[],
  now: Date,
): MonthSessionCount[] {
  // El Map arranca con la ventana completa en 0 para que los meses sin
  // sesiones aparezcan igual, y en orden cronológico: recorrerlo después
  // respeta el orden de inserción.
  const counts = new Map<string, number>();
  for (let offset = -(SESSIONS_BY_MONTH_WINDOW - 1); offset <= 0; offset++) {
    counts.set(utcMonthKey(utcMonthStart(now, offset)), 0);
  }

  for (const date of dates) {
    // Solo cuenta lo que cae en la ventana pre-cargada: una sesión fechada a
    // futuro (la API tolera hasta 5 días) puede caer en el mes siguiente, y
    // ese mes no se pinta.
    const key = utcMonthKey(date);
    const current = counts.get(key);
    if (current !== undefined) counts.set(key, current + 1);
  }

  return [...counts].map(([month, count]) => ({ month, count }));
}

// GET /api/dashboard/stats — métricas agregadas del tenant para el dashboard.
router.get('/stats', async (req, res) => {
  const now = new Date();

  const counts = await dashboardRepo.getStats(req.context, {
    monthStart: utcMonthStart(now),
    nextMonthStart: utcMonthStart(now, 1),
    chartWindowStart: utcMonthStart(now, -(SESSIONS_BY_MONTH_WINDOW - 1)),
    pathologiesTop: PATHOLOGIES_TOP,
  });

  const stats: DashboardStats = {
    activePatients: counts.activePatients,
    totalSessions: counts.totalSessions,
    sessionsThisMonth: counts.sessionsThisMonth,
    pendingPayments: counts.pendingPayments,
    pathologies: counts.pathologies,
    sessionsByMonth: aggregateSessionsByMonth(counts.sessionDates, now),
  };

  res.json({ data: stats });
});

export default router;
