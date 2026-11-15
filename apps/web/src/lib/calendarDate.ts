// A date with no time and no time zone: "YYYY-MM-DD", as the API sends a
// patient's date of birth. It is read from its three numbers, never through
// `new Date(...)`, which would make it a UTC midnight and show the day before
// in any browser west of Greenwich.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(day: string): { year: number; month: number; day: number } | null {
  const m = DAY.exec(day);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** "03/05/1980" for "1980-05-03"; null when it is not a day. */
export function formatDay(day: string | null | undefined): string | null {
  const parts = day ? parseDay(day) : null;
  if (!parts) return null;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(parts.day, 2)}/${pad(parts.month, 2)}/${pad(parts.year, 4)}`;
}

/** Whole years from a day to today (the device's calendar day); null when it is not a day. */
export function ageOnDay(day: string | null | undefined, today: Date = new Date()): number | null {
  const birth = day ? parseDay(day) : null;
  if (!birth) return null;
  let age = today.getFullYear() - birth.year;
  const month = today.getMonth() + 1;
  if (month < birth.month || (month === birth.month && today.getDate() < birth.day)) age--;
  return age;
}
