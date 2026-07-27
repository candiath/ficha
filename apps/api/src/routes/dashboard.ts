import { Router } from 'express';
import { SessionType } from '@prisma/client';
import type { DashboardStats, MonthSessionCount } from '@ficha/shared';

const router = Router();

// Meses que muestra el gráfico "Sesiones por mes" (incluye el mes actual).
const SESSIONS_BY_MONTH_WINDOW = 6;
// Cantidad de motivos de consulta del donut de patologías.
const PATHOLOGIES_TOP = 5;

// Las notas rápidas (sessionType NOTE) no son sesiones clínicas: quedan fuera
// de todos los conteos. SESSION y DISCHARGE sí cuentan.
const CLINICAL_SESSION_WHERE = { sessionType: { not: SessionType.NOTE } };

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
// Todas las queries van por req.db: el tenant scope inyecta tenantId también
// en count/groupBy, así que acá no se filtra por tenant a mano.
router.get('/stats', async (req, res) => {
  const now = new Date();
  const monthStart = utcMonthStart(now);
  const nextMonthStart = utcMonthStart(now, 1);
  const chartWindowStart = utcMonthStart(now, -(SESSIONS_BY_MONTH_WINDOW - 1));

  const [
    activePatients,
    totalSessions,
    sessionsThisMonth,
    pendingPayments,
    pathologyGroups,
    chartSessions,
  ] = await Promise.all([
    // "Activo" = paciente vigente con al menos un episodio clínico abierto.
    req.db.patient.count({
      where: { deletedAt: null, clinicalEpisodes: { some: { status: 'ACTIVE' } } },
    }),
    req.db.session.count({ where: CLINICAL_SESSION_WHERE }),
    req.db.session.count({
      where: {
        ...CLINICAL_SESSION_WHERE,
        sessionDate: { gte: monthStart, lt: nextMonthStart },
      },
    }),
    req.db.payment.count({ where: { status: 'PENDING' } }),
    // mainComplaint es texto libre: se agrupa por string exacto, sin normalizar.
    req.db.clinicalEpisode.groupBy({
      by: ['mainComplaint'],
      where: { NOT: [{ mainComplaint: null }, { mainComplaint: '' }] },
      _count: { mainComplaint: true },
      orderBy: { _count: { mainComplaint: 'desc' } },
      take: PATHOLOGIES_TOP,
    }),
    // La agregación por mes se hace en JS y no con $queryRaw: el SQL crudo
    // no pasa por el tenant scope. El volumen por tenant (consultorio
    // unipersonal) hace que traer solo las fechas sea barato.
    // Contexto completo (y qué hacer si algún día el volumen molesta):
    // https://github.com/candiath/ficha/issues/64
    req.db.session.findMany({
      where: { ...CLINICAL_SESSION_WHERE, sessionDate: { gte: chartWindowStart } },
      select: { sessionDate: true },
    }),
  ]);

  const stats: DashboardStats = {
    activePatients,
    totalSessions,
    sessionsThisMonth,
    pendingPayments,
    pathologies: pathologyGroups.map((g) => ({
      // El where ya excluye null/vacío; el fallback es solo para el tipo.
      name: g.mainComplaint ?? '',
      count: g._count.mainComplaint,
    })),
    sessionsByMonth: aggregateSessionsByMonth(
      chartSessions.map((s) => s.sessionDate),
      now,
    ),
  };

  res.json({ data: stats });
});

export default router;
