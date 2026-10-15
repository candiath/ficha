import { z } from 'zod';

// A date as the patient remembers it (#238): a day, a month or a year, maybe
// approximate. "Se fracturó en 2019", "empezó a doler hace dos meses".
//
// It is stored as a real date, truncated to its precision (the first of the
// month, the first of January), plus the precision and an "approximate" mark.
// "Hace dos meses" is turned into the month it meant on the day it is written,
// so a year later the record still says that month, never "hace dos meses".
//
// One definition for both sides: the API validates with partialDateSchema, the
// web builds and shows dates with the functions below.

export const DATE_PRECISIONS = ['DAY', 'MONTH', 'YEAR'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export interface PartialDate {
  /** YYYY-MM-DD, truncated to the precision: 2024-03-01 for "marzo de 2024". */
  date: string;
  precision: DatePrecision;
  approximate: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The date cut to its precision: 2024-03-15 as MONTH is 2024-03-01. */
export function truncateToPrecision(date: string, precision: DatePrecision): string {
  const [y, m] = date.split('-');
  if (precision === 'YEAR') return `${y}-01-01`;
  if (precision === 'MONTH') return `${y}-${m}-01`;
  return date;
}

// Strict, and already truncated: a month stored as the 15th would read as a
// day somewhere else. The database checks the same (patient_events CHECKs).
export const partialDateSchema = z
  .strictObject({
    date: z.string().refine(isRealDate, { error: 'La fecha no es válida' }),
    precision: z.enum(DATE_PRECISIONS),
    approximate: z.boolean(),
  })
  .refine((d) => truncateToPrecision(d.date, d.precision) === d.date, {
    error: 'La fecha tiene más detalle que su precisión',
    path: ['date'],
  });

// ─── Building one ───────────────────────────────────────────────────────────

export const RELATIVE_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'] as const;
export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

// "Hace N días / semanas" is a day; "hace N meses", a month; "hace N años", a
// year. Always approximate: nobody counts the days back exactly.
const PRECISION_OF: Record<RelativeUnit, DatePrecision> = {
  DAYS: 'DAY',
  WEEKS: 'DAY',
  MONTHS: 'MONTH',
  YEARS: 'YEAR',
};

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "Hace `amount` `unit`", counted from `today` (a YYYY-MM-DD in the clinic's calendar). */
export function partialDateAgo(amount: number, unit: RelativeUnit, today: string): PartialDate {
  const [y, m, d] = today.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  if (unit === 'DAYS') at.setUTCDate(at.getUTCDate() - amount);
  if (unit === 'WEEKS') at.setUTCDate(at.getUTCDate() - amount * 7);
  if (unit === 'MONTHS') at.setUTCMonth(at.getUTCMonth() - amount, 1);
  if (unit === 'YEARS') at.setUTCFullYear(at.getUTCFullYear() - amount, 0, 1);
  const precision = PRECISION_OF[unit];
  return { date: truncateToPrecision(isoOf(at), precision), precision, approximate: true };
}

// ─── Showing one ────────────────────────────────────────────────────────────

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "12/03/2024", "marzo de 2024", "2019"; "~" in front when approximate. */
export function formatPartialDate(pd: PartialDate): string {
  const [y, m, d] = pd.date.split('-');
  const text =
    pd.precision === 'YEAR' ? y : pd.precision === 'MONTH' ? `${MONTHS[Number(m) - 1]} de ${y}` : `${d}/${m}/${y}`;
  return pd.approximate ? `~${text}` : text;
}

/**
 * How long ago, computed from `today` every time it is shown: "hace 3 meses",
 * "hace 5 años". Never finer than the date's precision: a month is not
 * counted in days.
 */
export function elapsedSince(pd: PartialDate, today: string): string {
  const [y, m, d] = pd.date.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const months = (ty - y) * 12 + (tm - m) - (pd.precision === 'DAY' && td < d ? 1 : 0);
  const years = pd.precision === 'YEAR' ? ty - y : Math.floor(months / 12);
  const plural = (n: number, one: string, many: string) => `hace ${n} ${n === 1 ? one : many}`;

  if (pd.precision === 'YEAR' || years >= 2) {
    return years <= 0 ? 'este año' : plural(years, 'año', 'años');
  }
  if (pd.precision === 'MONTH' || months >= 2) {
    return months <= 0 ? 'este mes' : plural(months, 'mes', 'meses');
  }
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days < 14) return plural(days, 'día', 'días');
  return plural(Math.floor(days / 7), 'semana', 'semanas');
}
