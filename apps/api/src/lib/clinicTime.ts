/**
 * Conversión entre la hora de pared de la clínica y el instante UTC que se
 * guarda.
 *
 * Un turno "de las 9:00" no es un instante: es una hora local. El instante al
 * que corresponde depende de la zona horaria de la clínica, que vive en
 * `Tenant.timezone`. Guardamos instantes (`timestamp`) porque es lo único que
 * ordena y compara bien, pero la app habla en horas de pared en las dos
 * puntas, así que la traducción tiene que pasar por algún lado.
 *
 * Pasa por acá, del lado del servidor y no del navegador, por tres razones:
 * el servidor es el que conoce la zona de la clínica; la zona del navegador
 * puede no ser la misma (un profesional de viaje, una notebook mal
 * configurada); y así hay una sola implementación en vez de una por cliente.
 *
 * Sin esto, agrupar por día se haría en UTC y un turno de las 22:00 aparecería
 * al día siguiente — el mismo corrimiento que el dashboard ya documenta en sus
 * conteos por mes, pero visible y todos los días.
 */

/** "YYYY-MM-DD" */
export const CLINIC_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** "HH:mm" en 24 horas */
export const CLINIC_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Cuánto se corre esa zona respecto de UTC en ese instante, en milisegundos.
 * Positivo al este de Greenwich; para Argentina da -3 h.
 *
 * Se le pregunta a `Intl` en vez de mantener una tabla: las reglas de horario
 * de verano cambian por decisión política y vienen con la ICU del runtime.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  );

  // La hora de pared de esa zona, releída como si fuera UTC. La diferencia
  // contra el instante real ES el offset.
  //
  // `hour % 24` no es cosmético: con hour12:false algunos runtimes devuelven
  // "24" para la medianoche en vez de "00".
  const comoSiFueraUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return comoSiFueraUTC - instant.getTime();
}

/**
 * "2026-09-07" + "09:00" en la zona de la clínica → el instante UTC.
 *
 * Se resuelve en dos pasadas: la primera adivina usando el offset que la zona
 * tiene en el instante equivocado, y la segunda corrige con el offset del
 * instante ya casi correcto. La diferencia solo aparece cerca de un cambio de
 * horario de verano — Argentina no tiene desde 2009, pero la función no debería
 * depender de eso.
 */
export function clinicTimeToInstant(date: string, time: string, timeZone: string): Date {
  const comoUTC = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(comoUTC.getTime())) {
    throw new Error(`Fecha u hora inválida: ${date} ${time}`);
  }

  const primera = new Date(comoUTC.getTime() - zoneOffsetMs(comoUTC, timeZone));
  return new Date(comoUTC.getTime() - zoneOffsetMs(primera, timeZone));
}

/** El instante UTC → la fecha y hora de pared de la clínica. */
export function instantToClinicTime(
  instant: Date,
  timeZone: string,
): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = Object.fromEntries(
    dtf.formatToParts(instant).map((p) => [p.type, p.value]),
  );

  const hora = String(Number(parts.hour) % 24).padStart(2, '0');
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hora}:${parts.minute}`,
  };
}

/**
 * El rango de instantes que cubren los días `from`..`to` **inclusive** en la
 * zona de la clínica.
 *
 * Devuelve `[desde, hasta)`: desde el comienzo de `from` hasta el comienzo del
 * día siguiente a `to`. Medio abierto a propósito — con `<=` un turno exacto a
 * medianoche caería en dos rangos consecutivos y aparecería dos veces al
 * paginar la agenda semana a semana.
 */
export function clinicDayRange(
  from: string,
  to: string,
  timeZone: string,
): { desde: Date; hasta: Date } {
  const desde = clinicTimeToInstant(from, '00:00', timeZone);

  // El día siguiente a `to`, calculado sobre la fecha calendario y no sumando
  // 24 h a un instante: un día con cambio de horario dura 23 o 25.
  const [y, m, d] = to.split('-').map(Number);
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
  const finExclusivo = siguiente.toISOString().slice(0, 10);

  return { desde, hasta: clinicTimeToInstant(finExclusivo, '00:00', timeZone) };
}

/** Suma minutos a un instante. Los turnos duran lo que duran, sin cruzar días. */
export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/**
 * El día de la semana de un instante **en la zona de la clínica**, con la
 * convención de `Date#getDay()`: 0 domingo … 6 sábado. La misma que usa
 * `Tenant.workdays`, para poder comparar sin traducir.
 */
export function clinicWeekday(instant: Date, timeZone: string): number {
  const nombre = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(instant);

  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return dias.indexOf(nombre);
}

/**
 * Suma días a una fecha calendario "YYYY-MM-DD", sin tocar horas.
 *
 * La recurrencia se calcula sobre la FECHA y no sumando 7×24 h a un instante:
 * si en el medio hay un cambio de horario de verano, sumar horas correría el
 * turno de las 9:00 a las 8:00 o a las 10:00. Sumando días y convirtiendo cada
 * ocurrencia por separado, "todos los martes a las 9" son las 9 siempre.
 */
export function addClinicDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
