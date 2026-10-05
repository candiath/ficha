import { describe, expect, it } from 'vitest';
import { describeUserAgent } from '@/lib/userAgent';

// Real User-Agent strings, including the ones that impersonate each other:
// Edge, Opera and Samsung Internet carry "Chrome/", Chrome carries "Safari/",
// and iOS carries "Mac OS X".
const CASES: Array<[string, string]> = [
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Chrome en Windows',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'Edge en Windows',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Firefox en Windows',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
    'Opera en Windows',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Safari en macOS',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Chrome en macOS',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Safari en iPhone',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
    'Chrome en iPhone',
  ],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'Safari en iPad',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.81 Mobile Safari/537.36',
    'Chrome en Android',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Samsung Internet en Android',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    'Firefox en Linux',
  ],
  [
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Chrome en ChromeOS',
  ],
];

describe('describeUserAgent', () => {
  it.each(CASES)('%s → %s', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it('names what it can when only one half is recognizable', () => {
    expect(describeUserAgent('SomeBot/1.0 (Windows NT 10.0)')).toBe('Navegador en Windows');
  });

  it('falls back for missing or unrecognizable values', () => {
    expect(describeUserAgent(null)).toBe('Navegador desconocido');
    expect(describeUserAgent('')).toBe('Navegador desconocido');
    expect(describeUserAgent('curl/8.4.0')).toBe('Navegador desconocido');
  });
});
