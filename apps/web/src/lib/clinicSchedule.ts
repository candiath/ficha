/**
 * Horario de atención de la clínica: cómo se muestra.
 *
 * Los días se guardan con la convención de `Date#getDay()` — 0 domingo … 6
 * sábado — porque es la que usa el navegador en todos lados y traducirla en
 * cada punta sería una fuente de errores de un día de corrimiento.
 */

export const WEEKDAYS = [
  { value: 0, short: 'Dom', long: 'Domingo' },
  { value: 1, short: 'Lun', long: 'Lunes' },
  { value: 2, short: 'Mar', long: 'Martes' },
  { value: 3, short: 'Mié', long: 'Miércoles' },
  { value: 4, short: 'Jue', long: 'Jueves' },
  { value: 5, short: 'Vie', long: 'Viernes' },
  { value: 6, short: 'Sáb', long: 'Sábado' },
] as const;

// La semana laboral argentina no empieza el domingo aunque getDay() sí: para
// elegir días, mostrarlos de lunes a domingo es lo que espera cualquiera.
export const WEEKDAYS_MONDAY_FIRST = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

/**
 * "Lunes a viernes", "Lunes, miércoles y viernes", "Sábados".
 *
 * Un rango corrido se abrevia con "a" porque es como se dice; si los días
 * están salteados no hay atajo y se enumeran. Se evalúa sobre la semana que
 * arranca el lunes, así que "sábado y domingo" sale como rango y no partido.
 */
export function formatWorkdays(workdays: number[]): string {
  if (workdays.length === 0) return 'Sin días de atención';
  if (workdays.length === 7) return 'Todos los días';

  const orden = WEEKDAYS_MONDAY_FIRST.map((d) => d.value);
  const elegidos = orden.filter((d) => workdays.includes(d));
  // Solo el primero va con mayúscula: los demás son palabras en medio de una
  // oración, no títulos.
  const nombres = elegidos.map((d, i) => {
    const largo = WEEKDAYS.find((w) => w.value === d)?.long ?? '';
    return i === 0 ? largo : largo.toLowerCase();
  });

  if (elegidos.length === 1) return nombres[0];

  // ¿Son consecutivos en el orden lunes→domingo?
  const posiciones = elegidos.map((d) => orden.indexOf(d));
  const corrido = posiciones.every((p, i) => i === 0 || p === posiciones[i - 1] + 1);

  // Con dos días "lunes a martes" suena mal, así que el rango se abrevia
  // recién a partir de tres.
  if (corrido && elegidos.length > 2) {
    return `${nombres[0]} a ${nombres[nombres.length - 1]}`;
  }

  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** "Lunes a viernes, 08:00 a 20:00" */
export function formatSchedule(
  workdays: number[],
  start: string,
  end: string,
): string {
  return `${formatWorkdays(workdays)}, ${start} a ${end}`;
}

// Las zonas horarias de Argentina. Es una lista corta y cerrada, así que un
// select evita el error de tipear un identificador IANA que no existe — que
// la API rechaza, pero mejor no llegar hasta ahí.
export const ARGENTINA_TIMEZONES = [
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'America/Argentina/Catamarca', label: 'Catamarca' },
  { value: 'America/Argentina/Cordoba', label: 'Córdoba' },
  { value: 'America/Argentina/Jujuy', label: 'Jujuy' },
  { value: 'America/Argentina/La_Rioja', label: 'La Rioja' },
  { value: 'America/Argentina/Mendoza', label: 'Mendoza' },
  { value: 'America/Argentina/Rio_Gallegos', label: 'Río Gallegos' },
  { value: 'America/Argentina/Salta', label: 'Salta' },
  { value: 'America/Argentina/San_Juan', label: 'San Juan' },
  { value: 'America/Argentina/San_Luis', label: 'San Luis' },
  { value: 'America/Argentina/Tucuman', label: 'Tucumán' },
  { value: 'America/Argentina/Ushuaia', label: 'Ushuaia' },
] as const;
