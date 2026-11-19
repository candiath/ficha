import { afterEach, describe, expect, it, vi } from 'vitest';
import { ageOnDay, formatDay } from '@/lib/calendarDate';

// A patient's date of birth is a day with no time zone: it shows as the same
// day wherever the browser is (a UTC midnight read in local time showed the day
// before west of Greenwich).
describe('formatDay', () => {
  it('writes a day as dd/mm/yyyy', () => {
    expect(formatDay('1980-05-03')).toBe('03/05/1980');
    expect(formatDay('2000-01-01')).toBe('01/01/2000');
  });

  it('answers null for no day or for something that is not one', () => {
    for (const value of [null, undefined, '', 'ayer', '1980-05-03T00:00:00.000Z', '1980-5-3']) {
      expect(formatDay(value)).toBeNull();
    }
  });
});

describe('ageOnDay', () => {
  it('counts whole years, and the birthday itself counts', () => {
    expect(ageOnDay('1980-05-03', new Date(2026, 4, 2))).toBe(45);
    expect(ageOnDay('1980-05-03', new Date(2026, 4, 3))).toBe(46);
    expect(ageOnDay('1980-05-03', new Date(2026, 11, 31))).toBe(46);
  });

  it('answers null for no day or for something that is not one', () => {
    expect(ageOnDay(null)).toBeNull();
    expect(ageOnDay('1980-05-03T00:00:00.000Z')).toBeNull();
  });
});

// The same days in a time zone west of Greenwich and one east of it. Node reads
// TZ when the Date is first used, so the zone is set before the check.
describe.each(['America/Argentina/Buenos_Aires', 'Pacific/Auckland', 'UTC'])('in %s', (zone) => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    vi.useRealTimers();
  });

  it('shows 1980-05-03 as 03/05/1980 and ages from the local calendar day', () => {
    process.env.TZ = zone;
    expect(formatDay('1980-05-03')).toBe('03/05/1980');
    expect(ageOnDay('1980-05-03', new Date(2026, 4, 3, 0, 30))).toBe(46);
    expect(ageOnDay('1980-05-03', new Date(2026, 4, 2, 23, 30))).toBe(45);
  });
});
