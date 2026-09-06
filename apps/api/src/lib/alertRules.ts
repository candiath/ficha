import {
  clinicalAlertRepo,
  episodeRepo,
  patientRepo,
  paymentRepo,
  tenantRepo,
} from '../repositories';
import type { TenantContext } from '../repositories/types';

/**
 * El motor de alertas clínicas.
 *
 * Las alertas se recalculan **al leerlas**, no por un cron: el plan free de
 * Render no tiene uno, y montar infraestructura para esto sería
 * desproporcionado. La marca `Tenant.alertsRefreshedAt` evita rehacer el
 * trabajo en cada request.
 *
 * Corre acá y no dentro de una ruta de paciente a propósito. La regla de
 * inactividad vivía en el GET de episodios, así que solo se evaluaba al abrir
 * una ficha: **el paciente que nadie miraba nunca generaba alerta**, que es
 * justo al revés de lo que se quiere de un sistema de alertas.
 *
 * Cada regla mira toda la clínica, decide a quién le corresponde una alerta, y
 * deja que el cooldown evite repetirla. Agregar una regla es agregar una
 * función a `REGLAS`.
 */

// Cada cuánto se recalcula. El badge del layout pide las stats en cada carga
// de página, así que sin esto el motor correría decenas de veces por minuto.
const REFRESCO_CADA_MINUTOS = 15;

// Días sin sesiones antes de que un episodio abierto pida seguimiento.
const DIAS_DE_INACTIVIDAD = 21;

// Días desde la sesión antes de que un cobro pendiente pida acción. Con un
// paciente semanal, una sesión sin cobrar es normal durante la semana; dos
// semanas ya es deuda que conviene mirar.
const DIAS_DE_COBRO_VENCIDO = 14;

// No repetir la misma alerta mientras la anterior siga sin leer.
const COOLDOWN_DIAS = 7;

function haceDias(dias: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d;
}

function pesos(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(monto);
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

/** Lo que una regla decide: a quién avisarle, de qué, y con qué texto. */
interface AlertaPropuesta {
  patientId: string;
  type: 'FOLLOW_UP' | 'PAYMENT';
  message: string;
}

/**
 * Un episodio abierto que hace mucho no tiene sesiones.
 *
 * Los episodios sin ninguna sesión quedan afuera: uno recién abierto no es un
 * tratamiento abandonado — al paciente se lo da de alta justo cuando viene a
 * atenderse, así que ese hueco siempre es de horas.
 */
async function episodiosInactivos(ctx: TenantContext): Promise<AlertaPropuesta[]> {
  const episodios = await episodeRepo.listStale(ctx, haceDias(DIAS_DE_INACTIVIDAD));

  return episodios
    .filter((e) => e.lastActivityAt !== null)
    .map((e) => {
      const dias = Math.floor(
        (Date.now() - Date.parse(e.lastActivityAt as string)) / 86_400_000,
      );
      const motivo = e.mainComplaint ? `"${e.mainComplaint}"` : 'el episodio activo';
      return {
        patientId: e.patientId,
        // Seguimiento y no inasistencia: faltar es no venir a un turno
        // agendado, y eso ahora lo detecta la agenda.
        type: 'FOLLOW_UP' as const,
        message:
          `Sin sesiones en ${dias} días (episodio ${motivo}). ` +
          'Considerá contactar al paciente o marcar el episodio como abandonado.',
      };
    });
}

/**
 * Cobros pendientes que ya llevan tiempo.
 *
 * Se agrupan por paciente en vez de generar una alerta por cobro: lo que hay
 * que hacer es hablar con la persona una vez, no seis.
 */
async function cobrosVencidos(ctx: TenantContext): Promise<AlertaPropuesta[]> {
  const pendientes = await paymentRepo.list(ctx, { status: 'PENDING' });

  // Los cobros de un paciente borrado siguen listándose a propósito (el
  // historial conserva su nombre), pero una alerta pide una acción y sobre un
  // paciente eliminado esa acción es imposible.
  const vigentes = new Set((await patientRepo.list(ctx)).map((p) => p.id));

  const porPaciente = new Map<
    string,
    { cantidad: number; total: number; masVieja: string }
  >();

  for (const cobro of pendientes) {
    if (!vigentes.has(cobro.patientId)) continue;
    const previo = porPaciente.get(cobro.patientId);
    if (previo) {
      previo.cantidad += 1;
      previo.total += cobro.finalAmount;
      if (cobro.session.sessionDate < previo.masVieja) {
        previo.masVieja = cobro.session.sessionDate;
      }
    } else {
      porPaciente.set(cobro.patientId, {
        cantidad: 1,
        total: cobro.finalAmount,
        masVieja: cobro.session.sessionDate,
      });
    }
  }

  const limite = haceDias(DIAS_DE_COBRO_VENCIDO).toISOString();

  return [...porPaciente.entries()]
    // El umbral se mide sobre la sesión MÁS VIEJA sin cobrar: es la que dice
    // hace cuánto que esto viene arrastrándose.
    .filter(([, datos]) => datos.masVieja < limite)
    .map(([patientId, datos]) => ({
      patientId,
      type: 'PAYMENT' as const,
      message:
        datos.cantidad === 1
          ? `Sesión sin cobrar del ${fechaCorta(datos.masVieja)} por ${pesos(datos.total)}.`
          : `${datos.cantidad} sesiones sin cobrar por ${pesos(datos.total)}. ` +
            `La más vieja es del ${fechaCorta(datos.masVieja)}.`,
    }));
}

const REGLAS = [episodiosInactivos, cobrosVencidos];

/**
 * Corre las reglas si toca, y crea las alertas que falten.
 *
 * Devuelve cuántas creó; 0 también cuando no le tocaba correr. Nunca lanza:
 * un fallo del motor no debe impedir leer las alertas que ya existen, que es
 * lo que el usuario pidió.
 */
export async function refreshAlerts(ctx: TenantContext): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - REFRESCO_CADA_MINUTOS * 60_000);
    if (!(await tenantRepo.claimAlertsRefresh(ctx, cutoff))) return 0;

    const propuestas = (await Promise.all(REGLAS.map((regla) => regla(ctx)))).flat();
    const desde = haceDias(COOLDOWN_DIAS);

    let creadas = 0;
    for (const propuesta of propuestas) {
      const yaHay = await clinicalAlertRepo.hasRecentUnread(
        ctx,
        propuesta.patientId,
        propuesta.type,
        desde,
      );
      if (yaHay) continue;
      await clinicalAlertRepo.create(ctx, propuesta);
      creadas += 1;
    }
    return creadas;
  } catch (err) {
    console.error('[alertas] el motor falló', err);
    return 0;
  }
}
