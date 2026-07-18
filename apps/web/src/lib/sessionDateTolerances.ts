/**
 * Tolerancias para la fecha/hora de una sesión.
 *
 * Hoy son valores fijos. El día que exista persistencia y un modelo de
 * preferencias por usuario, esto se reemplaza por algo tipo
 * `useSessionDateTolerances()` que lea el perfil del médico y caiga a
 * DEFAULT_SESSION_DATE_TOLERANCES cuando falte. Los consumidores no cambian:
 * `getSessionDateWarnings(value, tolerances)` recibe el objeto ya resuelto.
 */
export interface SessionDateTolerances {
  /** Margen a futuro permitido SIN advertir, en ms. Ej: registrar 16:00 siendo 15:55. */
  futureToleranceMs: number
  /** A partir de cuánto en el pasado se advierte un registro tardío, en ms. */
  pastWarnThresholdMs: number
}

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

// Valores por defecto hasta que exista config por usuario. La política:
// - 15 min de margen a futuro: cubre el caso de registrar una sesión "16:00"
//   estando 15:55, sin advertir por un adelanto normal.
// - 1 día para avisar de registro tardío: el médico puede cargar sesiones
//   horas después de atender sin molestias; recién pasado un día se avisa.
export const DEFAULT_SESSION_DATE_TOLERANCES: SessionDateTolerances = {
  futureToleranceMs: 15 * MINUTE_MS,
  pastWarnThresholdMs: 1 * DAY_MS,
}

/**
 * Punto único de acceso a las tolerancias vigentes.
 *
 * Hoy devuelve los valores fijos. Cuando exista el modelo de preferencias, acá
 * adentro se lee el perfil del médico (AuthContext / react-query) y se hace
 * merge sobre DEFAULT_SESSION_DATE_TOLERANCES para los campos que falten.
 * La firma no cambia, así que ningún consumidor se entera.
 *
 * Es un hook (y no una función común) a propósito: la implementación futura
 * necesita leer contexto/queries, y eso sólo puede hacerse desde un hook.
 */
export function useSessionDateTolerances(): SessionDateTolerances {
  return DEFAULT_SESSION_DATE_TOLERANCES
}
