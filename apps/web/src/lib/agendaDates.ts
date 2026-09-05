/**
 * Fechas de la agenda.
 *
 * Todo acá trabaja con strings "YYYY-MM-DD" y nunca con objetos `Date`
 * convertidos por la zona del navegador. No es purismo: la API ya devuelve
 * cada turno con su fecha y hora de pared de la clínica resueltas, y en el
 * momento en que el navegador vuelve a convertir aparece el error de un día
 * —un turno de las 22:00 mostrado el día siguiente— que todo el diseño de
 * `clinicTime.ts` existe para evitar.
 *
 * La aritmética interna usa `Date.UTC`, que es seguro justamente porque no
 * consulta ninguna zona horaria: es calendario puro.
 */

/** Hoy, en la zona de la clínica y no en la del navegador. */
export function todayInClinic(timeZone: string): string {
  // en-CA formatea como YYYY-MM-DD, que es exactamente lo que necesitamos.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 domingo … 6 sábado, igual que `Date#getDay()` y que `Tenant.workdays`. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** El lunes de la semana que contiene esa fecha. */
export function mondayOf(date: string): string {
  const dia = weekdayOf(date);
  // Domingo (0) pertenece a la semana que arrancó seis días antes, no a la
  // que empieza al día siguiente.
  return addDays(date, dia === 0 ? -6 : 1 - dia);
}

/** Los `length` días consecutivos a partir de `from`. */
export function daysFrom(from: string, length: number): string[] {
  return Array.from({ length }, (_, i) => addDays(from, i));
}

/**
 * La grilla del mes: siempre 6 semanas completas de lunes a domingo.
 *
 * Fija en 42 celdas a propósito. Un mes ocupa 4, 5 o 6 filas según en qué día
 * caiga el 1°, y una grilla que cambia de alto hace saltar la página al
 * navegar de mes en mes.
 */
export function monthGrid(year: number, month: number): string[] {
  const primero = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return daysFrom(mondayOf(primero), 42);
}

export function isSameMonth(date: string, year: number, month: number): boolean {
  const [y, m] = date.split('-').map(Number);
  return y === year && m === month + 1;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado',
];

export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

export function shortWeekday(date: string): string {
  return DIAS_CORTOS[weekdayOf(date)];
}

export function longWeekday(date: string): string {
  return DIAS_LARGOS[weekdayOf(date)];
}

/** "Lunes 7 de septiembre" */
export function formatLongDate(date: string): string {
  const [, m] = date.split('-').map(Number);
  return `${longWeekday(date)} ${dayNumber(date)} de ${MESES[m - 1]}`;
}

/** "Septiembre 2026" */
export function formatMonth(year: number, month: number): string {
  const nombre = MESES[month];
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} ${year}`;
}

/**
 * "7 – 12 de septiembre de 2026", o con los dos meses cuando la semana los
 * cruza. Es el encabezado de la vista semanal.
 */
export function formatRange(from: string, to: string): string {
  const [ay, am] = from.split('-').map(Number);
  const [by, bm] = to.split('-').map(Number);
  const desde = dayNumber(from);
  const hasta = dayNumber(to);

  if (ay === by && am === bm) {
    return `${desde} – ${hasta} de ${MESES[am - 1]} de ${ay}`;
  }
  if (ay === by) {
    return `${desde} de ${MESES[am - 1]} – ${hasta} de ${MESES[bm - 1]} de ${ay}`;
  }
  return `${desde} de ${MESES[am - 1]} ${ay} – ${hasta} de ${MESES[bm - 1]} ${by}`;
}

/**
 * Las horas en punto que dibuja la grilla semanal, desde la apertura hasta el
 * cierre de la clínica. El cierre no se incluye: a esa hora ya no se atiende.
 */
export function hourSlots(workdayStart: string, workdayEnd: string): string[] {
  const desde = Number(workdayStart.slice(0, 2));
  const hasta = Number(workdayEnd.slice(0, 2));
  if (hasta <= desde) return [];
  return Array.from({ length: hasta - desde }, (_, i) =>
    `${String(desde + i).padStart(2, '0')}:00`,
  );
}

/** En qué hora en punto de la grilla cae un turno que empieza a las HH:mm. */
export function hourSlotOf(time: string): string {
  return `${time.slice(0, 2)}:00`;
}

/**
 * ¿Se pisan dos turnos? Compara horas "HH:mm" del mismo día, que ordenan
 * lexicográficamente.
 *
 * Solapar está permitido —sobreturnos, una reprogramación de apuro— así que
 * esto no bloquea nada: alimenta el aviso que la pantalla muestra antes de
 * guardar.
 */
export function overlaps(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** "09:00" + 45 → "09:45". Se queda dentro del día. */
export function addMinutesToTime(time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
