import { describe, expect, it } from 'vitest';
import { elapsedSince, formatPartialDate, partialDateAgo, partialDateSchema } from '@ficha/shared';

// A date as the patient remembers it (#238). The point of it: "hace dos meses"
// becomes the month it meant, so the record does not age.
describe('partial dates', () => {
  it('turns "hace N…" into a date at its precision, approximate', () => {
    expect(partialDateAgo(2, 'MONTHS', '2026-10-14')).toEqual({ date: '2026-08-01', precision: 'MONTH', approximate: true });
    expect(partialDateAgo(3, 'WEEKS', '2026-10-14')).toEqual({ date: '2026-09-23', precision: 'DAY', approximate: true });
    expect(partialDateAgo(5, 'YEARS', '2026-10-14')).toEqual({ date: '2021-01-01', precision: 'YEAR', approximate: true });
    // From March 31st, two months back is January, not a day of March.
    expect(partialDateAgo(2, 'MONTHS', '2026-03-31').date).toBe('2026-01-01');
  });

  it('says how long ago from the day it is shown, so a year later it still points at the same month', () => {
    const onset = partialDateAgo(2, 'MONTHS', '2026-10-14');
    expect(elapsedSince(onset, '2026-10-14')).toBe('hace 2 meses');
    expect(elapsedSince(onset, '2027-10-14')).toBe('hace 14 meses');
    expect(elapsedSince(onset, '2028-10-14')).toBe('hace 2 años');
  });

  it('shows each precision as the patient said it', () => {
    expect(formatPartialDate({ date: '2019-01-01', precision: 'YEAR', approximate: false })).toBe('2019');
    expect(formatPartialDate({ date: '2024-03-01', precision: 'MONTH', approximate: true })).toBe('~marzo de 2024');
    expect(formatPartialDate({ date: '2026-02-20', precision: 'DAY', approximate: false })).toBe('20/02/2026');
  });

  it('refuses a date with more detail than its precision, and an impossible one', () => {
    expect(partialDateSchema.safeParse({ date: '2024-03-15', precision: 'MONTH', approximate: false }).success).toBe(false);
    expect(partialDateSchema.safeParse({ date: '2023-02-29', precision: 'DAY', approximate: false }).success).toBe(false);
    expect(partialDateSchema.safeParse({ date: '2024-03-01', precision: 'MONTH', approximate: true }).success).toBe(true);
  });
});
