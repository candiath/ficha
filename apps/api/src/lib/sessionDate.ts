import { z } from 'zod';

/**
 * Validación server-side de la fecha de una sesión.
 *
 * Contexto (ver .notes/sesiones-fecha-timezone-y-validacion.md): la política de
 * fechas nació sólo en el frontend. Ahí hay dos capas:
 *   - error DURO (vacío / ilegible) → bloquea el submit (Zod).
 *   - advertencia BLANDA (futuro > 15 min, pasado > 1 día) → sólo avisa, deja enviar.
 *
 * Este módulo aporta el TOPE DURO al backend: sin él, un `curl` directo saltea
 * toda la validación y guarda una fecha arbitraria (año tipeado mal, timestamp
 * corrupto). El criterio es atajar datos claramente rotos y nada más: lo que
 * es inusual pero posible —una sesión cargada tarde, o la historia previa de
 * un paciente que venís tratando hace meses— la API lo acepta y el frontend
 * lo advierte.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const APIFutureDateTolerance = DAY_MS * 5;

// Piso absoluto de fecha de sesión. No es una tolerancia relativa a "ahora":
// es el filtro de datos rotos. Una fecha simplemente vieja es legítima —al
// empezar a usar Ficha lo primero que hace falta es cargar la historia de los
// pacientes que ya venís tratando— y la API la tiene que aceptar. Lo que no
// puede pasar es una fecha del año 1025 o 2202: eso es un año tipeado mal.
//
// Antes esto era una tolerancia de 15 días hacia atrás, pensada para el caso
// "cargué la sesión unas horas más tarde". Su efecto real era bloquear toda
// migración de historia previa, que es justo lo que se necesita al arrancar.
// La advertencia blanda del frontend (más de un día en el pasado) se queda:
// avisa sin bloquear, que es el nivel correcto para una fecha inusual.
const MIN_SESSION_DATE_MS = Date.UTC(2000, 0, 1);

// Exportadas para que los tests (y el mensaje de error) hablen en las mismas
// unidades que la política, sin repetir el número mágico.
export { MINUTE_MS, HOUR_MS, DAY_MS, APIFutureDateTolerance, MIN_SESSION_DATE_MS };

/**
 * ¿La fecha cae más allá del tope duro permitido a futuro? Si devuelve true, el
 * schema rechaza el request con 400.
 *
 * @param date fecha de la sesión ya parseada a Date
 * @param now  instante de referencia en ms (inyectable para testear)
 */
export function isSessionDateTooFarInFuture(date: Date, now: number = Date.now()): boolean {
  // Un Invalid Date da getTime() === NaN, y `NaN > x` es siempre false: sin este
  // guard una fecha ilegible se colaría como válida. z.iso.datetime() ya la corta
  // en el schema, pero el predicado no debe confiar en su llamador (defensa en
  // profundidad ante un request armado a mano).
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() - now > APIFutureDateTolerance;
}

/**
 * ¿La fecha es anterior al piso absoluto? Si devuelve true, el schema rechaza
 * el request con 400.
 *
 * A diferencia del tope de futuro, éste no se mide contra "ahora": no importa
 * cuán vieja sea la sesión, importa que la fecha sea posible. Por eso no toma
 * un `now` — el resultado no depende de cuándo se pregunte, y una fecha futura
 * queda trivialmente por encima del piso.
 *
 * @param date fecha de la sesión ya parseada a Date
 */
export function isSessionDateBeforeFloor(date: Date): boolean {
  // Mismo guard que el de futuro: un Invalid Date (getTime() === NaN) debe
  // rechazarse, no colarse por el `false` implícito de comparar contra NaN.
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() < MIN_SESSION_DATE_MS;
}

/**
 * Field Zod reutilizable con el error DURO de fecha, replicado del frontend:
 *  - .datetime() bloquea vacío / ilegible / sin hora (equivale al superRefine
 *    de Zod en el form).
 *  - los .refine() aplican los topes duros que el frontend no tiene (allá sólo
 *    se advierte): un margen de días hacia adelante y un piso absoluto hacia
 *    atrás. Al vivir en el field, cubren POST y PATCH por igual:
 *    SessionUpdateSchema es .partial(), pero el refine corre cuando la fecha
 *    viene presente.
 */
export const sessionDateField = z.iso
  .datetime({ error: 'La fecha de sesión es ilegible o está vacía' })
  .refine((value) => !isSessionDateTooFarInFuture(new Date(value)), {
    error: 'La fecha de sesión está demasiado lejos en el futuro',
  })
  .refine((value) => !isSessionDateBeforeFloor(new Date(value)), {
    error: 'La fecha de sesión es anterior al año 2000: revisá el año',
  });

