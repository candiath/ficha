// Money travels in integer cents ($1.234,56 is 123456): the API refuses
// anything else. Pesos exist only on screen, and the conversion lives here, so
// no component multiplies or divides by 100 on its own.

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

/** 123456 → "$ 1.234,56" */
export function formatCents(cents: number): string {
  return ARS.format(cents / 100);
}

/**
 * What a user typed in pesos, in cents; null when it is not an amount of
 * money. Parsed from the string, never through a float, so "0.29" is 29 and
 * not 28.999…. A comma works as the decimal separator too; a third decimal is
 * refused instead of rounded.
 */
export function parsePesos(input: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 123456 → "1234.56", 750000 → "7500": the value of an <input type="number">. */
export function centsToInput(cents: number): string {
  const pesos = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(pesos) : `${pesos}.${String(rest).padStart(2, '0')}`;
}
