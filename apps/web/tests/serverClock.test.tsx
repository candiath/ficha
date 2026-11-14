import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClockSkewNotice from '@/components/layout/ClockSkewNotice';
import { api } from '@/lib/api';
import { describeClockSkew, recordServerTime, serverNow } from '@/lib/serverClock';

const MINUTE_MS = 60_000;

// A sample with no round trip: the device reads `now`, the API `now + offset`.
function sample(offsetMs: number) {
  const now = Date.now();
  recordServerTime(new Date(now + offsetMs).toISOString(), now, now);
}

afterEach(() => {
  act(() => sample(0));
  vi.unstubAllGlobals();
});

describe('the API clock, as the web measures it', () => {
  it('tells the real time when the device runs behind', () => {
    sample(10 * MINUTE_MS);

    const drift = serverNow().getTime() - Date.now();

    expect(drift).toBeGreaterThan(10 * MINUTE_MS - 1000);
    expect(drift).toBeLessThanOrEqual(10 * MINUTE_MS);
  });

  it('counts the time of the trip: the sample sits halfway through it', () => {
    const sentAt = Date.now();
    recordServerTime(new Date(sentAt + 1000).toISOString(), sentAt, sentAt + 2000);

    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('ignores a slow response, which says nothing about the clock', () => {
    const sentAt = Date.now();
    recordServerTime(new Date(sentAt + 50_000).toISOString(), sentAt, sentAt + 50_000);

    expect(Math.abs(serverNow().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('is measured on every response of the API client, even a refused one', async () => {
    const headers = new Headers({ 'X-Server-Time': new Date(Date.now() + 10 * MINUTE_MS).toISOString() });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, headers, json: () => Promise.resolve({ error: 'No' }) }),
    );

    await expect(api.get('/api/anything')).rejects.toThrow('No');

    expect(serverNow().getTime() - Date.now()).toBeGreaterThan(9 * MINUTE_MS);
  });
});

describe('the notice of a device clock that is off', () => {
  it('says nothing under a minute', () => {
    sample(30_000);

    render(<ClockSkewNotice />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says how far behind the device is, and goes away once the clock is right', () => {
    render(<ClockSkewNotice />);

    act(() => sample(10 * MINUTE_MS + 1000));
    expect(screen.getByRole('status').textContent).toContain('atrasada 10 min');

    act(() => sample(0));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rounds a sample that lands just short of the real difference', () => {
    render(<ClockSkewNotice />);

    act(() => sample(10 * MINUTE_MS - 200));

    expect(screen.getByRole('status').textContent).toContain('atrasada 10 min');
  });

  it('words the size of the difference', () => {
    expect(describeClockSkew(10)).toBe('atrasada 10 min');
    expect(describeClockSkew(-120)).toBe('adelantada 2 h');
    expect(describeClockSkew(1440)).toBe('atrasada 1 día');
    expect(describeClockSkew(-3 * 1440)).toBe('adelantada 3 días');
  });
});
