import { SessionType } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  DashboardCounts,
  DashboardRepository,
  DashboardStatsParams,
} from '../dashboardRepository';

// Las notas rápidas (sessionType NOTE) no son sesiones clínicas: quedan fuera
// de todos los conteos. SESSION y DISCHARGE sí cuentan.
const CLINICAL_SESSION_WHERE = { sessionType: { not: SessionType.NOTE } };

export const prismaDashboardRepository: DashboardRepository = {
  async getStats(
    ctx: TenantContext,
    params: DashboardStatsParams,
  ): Promise<DashboardCounts> {
    const db = forTenant(ctx);
    // Todas las queries van por el cliente scopeado: el guard inyecta el
    // tenantId también en count/groupBy, así que acá no se filtra a mano.
    const [
      activePatients,
      totalSessions,
      sessionsThisMonth,
      pendingPayments,
      pathologyGroups,
      chartSessions,
    ] = await Promise.all([
      // "Activo" = paciente vigente con al menos un episodio clínico abierto.
      db.patient.count({
        where: { deletedAt: null, clinicalEpisodes: { some: { status: 'ACTIVE' } } },
      }),
      db.session.count({ where: CLINICAL_SESSION_WHERE }),
      db.session.count({
        where: {
          ...CLINICAL_SESSION_WHERE,
          sessionDate: { gte: params.monthStart, lt: params.nextMonthStart },
        },
      }),
      db.payment.count({ where: { status: 'PENDING' } }),
      // mainComplaint es texto libre: se agrupa por string exacto, sin normalizar.
      db.clinicalEpisode.groupBy({
        by: ['mainComplaint'],
        where: { NOT: [{ mainComplaint: null }, { mainComplaint: '' }] },
        _count: { mainComplaint: true },
        orderBy: { _count: { mainComplaint: 'desc' } },
        take: params.pathologiesTop,
      }),
      // La agregación por mes se hace en JS y no con $queryRaw: el SQL crudo
      // no pasa por el tenant scope. El volumen por tenant (consultorio
      // unipersonal) hace que traer solo las fechas sea barato.
      // Contexto completo (y qué hacer si algún día el volumen molesta):
      // https://github.com/candiath/ficha/issues/64
      db.session.findMany({
        where: { ...CLINICAL_SESSION_WHERE, sessionDate: { gte: params.chartWindowStart } },
        select: { sessionDate: true },
      }),
    ]);

    return {
      activePatients,
      totalSessions,
      sessionsThisMonth,
      pendingPayments,
      pathologies: pathologyGroups.map((g) => ({
        // El where ya excluye null/vacío; el fallback es solo para el tipo.
        name: g.mainComplaint ?? '',
        count: g._count.mainComplaint,
      })),
      sessionDates: chartSessions.map((s) => s.sessionDate),
    };
  },
};
