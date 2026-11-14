import { useSyncExternalStore } from 'react';

// How far this device's clock is from the API's, measured on every response
// (the X-Server-Time header). Episodes open and audit rows are stamped by the
// API's clock, so a "now" the web sends has to come from that one: a device
// running behind would date a closing before the opening it just saw.

export const SERVER_TIME_HEADER = 'X-Server-Time';

// The header's time falls somewhere inside the round trip, so a sample is off
// by up to half of it. A slow one (Render's cold start takes ~50 s) says
// nothing about the clock.
const MAX_ROUND_TRIP_MS = 5_000;

const MINUTE_MS = 60_000;

let offsetMs = 0;
const listeners = new Set<() => void>();

// Minutes the device runs behind the API (negative: ahead), rounded: a sample
// lands a few milliseconds short of the real difference. Under a minute is 0:
// no one needs to hear about it.
function skewMinutes(): number {
  return Math.abs(offsetMs) < MINUTE_MS ? 0 : Math.round(offsetMs / MINUTE_MS);
}

export function recordServerTime(serverTime: string | null, sentAt: number, receivedAt: number): void {
  const server = serverTime ? Date.parse(serverTime) : NaN;
  if (Number.isNaN(server) || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return;

  const before = skewMinutes();
  offsetMs = server - (sentAt + receivedAt) / 2;
  if (skewMinutes() !== before) listeners.forEach((notify) => notify());
}

/** The current time by the API's clock, as far as the last sample tells. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useClockSkewMinutes(): number {
  return useSyncExternalStore(subscribe, skewMinutes);
}

/** "atrasada 10 min", "adelantada 2 h", "atrasada 3 días". */
export function describeClockSkew(minutes: number): string {
  const direction = minutes > 0 ? 'atrasada' : 'adelantada';
  const size = Math.abs(minutes);
  if (size < 60) return `${direction} ${size} min`;
  if (size < 24 * 60) return `${direction} ${Math.round(size / 60)} h`;
  const days = Math.round(size / (24 * 60));
  return `${direction} ${days} ${days === 1 ? 'día' : 'días'}`;
}
