// Turns a raw User-Agent into the coarse label the device list shows:
// "Chrome en Windows", "Safari en iPhone", "Navegador desconocido".
//
// Deliberately small: the list only needs to let a user recognize her own
// devices, not an exact version or model. Order matters — Edge, Opera and
// Samsung Internet also say "Chrome", Chrome also says "Safari", and an
// iPhone's UA also says "Mac OS X".

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\b(OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const UNKNOWN = 'Navegador desconocido';

function match(ua: string, table: Array<[RegExp, string]>): string | null {
  return table.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
}

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return UNKNOWN;
  const browser = match(ua, BROWSERS);
  const system = match(ua, SYSTEMS);
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? (system ? `Navegador en ${system}` : UNKNOWN);
}
