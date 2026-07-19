import { z } from 'zod';

/**
 * Validación server-side de la fecha de una sesión.
 *
 * Contexto (ver .notes/sesiones-fecha-timezone-y-validacion.md): la política de
 * fechas nació sólo en el frontend. Ahí hay dos capas:
 *   - error DURO (vacío / ilegible) → bloquea el submit (Zod).
 *   - advertencia BLANDA (futuro > 15 min, pasado > 1 día) → sólo avisa, deja enviar.
 *
 * Este módulo aporta el TOPE DURO al backend: hoy un `curl` directo saltea toda
 * la validación y guarda una fecha arbitraria (año tipeado mal, timestamp
 * corrupto). Es un tope generoso —no la tolerancia blanda de 15 min— pensado
 * para atajar datos claramente rotos sin molestar el flujo de "cargué la sesión
 * unas horas más tarde".
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const APIFutureDateTolerance = DAY_MS * 5;
const APIPastDateTolerance = DAY_MS * 15;
// Exportadas para que los tests (y el mensaje de error) hablen en las mismas
// unidades que la política, sin repetir el número mágico. Los topes se exportan
// para que los tests de borde midan contra el valor real y no lo dupliquen.
export { MINUTE_MS, HOUR_MS, DAY_MS, APIFutureDateTolerance, APIPastDateTolerance };

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
 * ¿La fecha cae más allá del tope duro permitido a pasado? Si devuelve true, el
 * schema rechaza el request con 400.
 *
 * Mide en una sola dirección (now - date): una fecha futura da diff negativo y
 * nunca supera el tope, así que este chequeo no se pisa con el de futuro.
 *
 * @param date fecha de la sesión ya parseada a Date
 * @param now  instante de referencia en ms (inyectable para testear)
 */
export function isSessionDateTooFarInPast(date: Date, now: number = Date.now()): boolean {
  // Mismo guard que el de futuro: un Invalid Date (getTime() === NaN) debe
  // rechazarse, no colarse por el `false` implícito de comparar contra NaN.
  if (Number.isNaN(date.getTime())) return true;
  return now - date.getTime() > APIPastDateTolerance;
}

/**
 * Field Zod reutilizable con el error DURO de fecha, replicado del frontend:
 *  - .datetime() bloquea vacío / ilegible / sin hora (equivale al superRefine
 *    de Zod en el form).
 *  - los .refine() aplican los topes duros que el frontend no tiene (allá sólo
 *    se advierte). Al vivir en el field, cubren POST y PATCH por igual:
 *    SessionUpdateSchema es .partial(), pero el refine corre cuando la fecha
 *    viene presente.
 */
export const sessionDateField = z.iso
  .datetime({ error: 'La fecha de sesión es ilegible o está vacía' })
  .refine((value) => !isSessionDateTooFarInFuture(new Date(value)), {
    error: 'La fecha de sesión está demasiado lejos en el futuro',
  })
  .refine((value) => !isSessionDateTooFarInPast(new Date(value)), {
    error: 'La fecha de sesión está demasiado lejos en el pasado',
  });

