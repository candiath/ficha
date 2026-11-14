import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parsePesos } from '@/lib/money';

describe('money in cents', () => {
  it('parses pesos into cents from the string, never through a float', () => {
    expect(parsePesos('1234.56')).toBe(123456);
    expect(parsePesos('1234,56')).toBe(123456);
    expect(parsePesos('7500')).toBe(750000);
    expect(parsePesos('0.29')).toBe(29);
    expect(parsePesos('0.1')).toBe(10);
    expect(parsePesos(' 15 ')).toBe(1500);
  });

  it('refuses what is not an amount, and a third decimal instead of rounding it', () => {
    for (const input of ['', 'abc', '-5', '10.004', '1.2.3', '1e3']) {
      expect(parsePesos(input)).toBeNull();
    }
  });

  it('writes cents back as an input value', () => {
    expect(centsToInput(123456)).toBe('1234.56');
    expect(centsToInput(750000)).toBe('7500');
    expect(centsToInput(5)).toBe('0.05');
    expect(parsePesos(centsToInput(123456))).toBe(123456);
  });

  it('shows cents as pesos', () => {
    expect(formatCents(123456)).toBe(new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(1234.56));
  });
});
