import { useSyncExternalStore } from 'react';

// Whether this web is out of step with the API it talks to. Both are built
// from the same commit and deployed separately (Netlify, Render), so for a
// while after each release they can disagree: a tab opened before the release
// keeps running the old web, and the new web can reach the API before the
// API's deploy finishes (or after it fails). Each side carries the commit time
// of the commit it was built from (scripts/build-version.mjs); the API sends
// its own as X-Build-Version on every response, and api.ts hands it here
// before the caller reads the response.
//
// Without a version on either side (the dev server, `npm run dev:api`, the
// tests) there is nothing to compare and no check.

export const BUILD_VERSION_HEADER = 'X-Build-Version';

export type VersionSkew =
  /** The web is older: reloading brings the new one. */
  | { kind: 'reload' }
  /**
   * The web is older, and it was already reloaded for this API: the web's
   * deploy is the one still running (or failed). Another reload may help later.
   */
  | { kind: 'web-deploying' }
  /** The API is older: its deploy is still running, or failed. Reloading does not help. */
  | { kind: 'api-deploying' };

// The API version a reload was asked for, kept across the reload: if the web
// that comes back is still older than it, asking again would loop.
const RELOADED_FOR_KEY = 'ficha:reloaded-for-build';

let skew: VersionSkew | null = null;
// The newer API version seen, for reloadForNewVersion.
let lastApiVersion: string | null = null;
const listeners = new Set<() => void>();

function webVersion(): string | null {
  return (import.meta.env.VITE_BUILD_VERSION as string | undefined) || null;
}

function setSkew(next: VersionSkew | null): void {
  if (next?.kind === skew?.kind) return;
  skew = next;
  listeners.forEach((notify) => notify());
}

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY);
  } catch {
    return null;
  }
}

/**
 * Compares the API's version with this web's and records the result. Returns
 * whether they disagree, so the caller can refuse to read the response.
 */
export function recordApiVersion(apiVersion: string | null): boolean {
  const web = webVersion();
  if (!web || !apiVersion) return false;

  const diff = Number(web) - Number(apiVersion);
  if (Number.isNaN(diff)) return false;

  if (diff === 0) {
    try {
      sessionStorage.removeItem(RELOADED_FOR_KEY);
    } catch {
      // Storage unavailable: nothing to forget.
    }
    setSkew(null);
    return false;
  }

  if (diff > 0) {
    setSkew({ kind: 'api-deploying' });
  } else {
    setSkew({ kind: reloadedFor() === apiVersion ? 'web-deploying' : 'reload' });
    lastApiVersion = apiVersion;
  }
  return true;
}

/** Reloads the page, remembering which API version it was reloaded for. */
export function reloadForNewVersion(): void {
  try {
    if (lastApiVersion) sessionStorage.setItem(RELOADED_FOR_KEY, lastApiVersion);
  } catch {
    // Storage unavailable: at worst the notice asks once more after the reload.
  }
  window.location.reload();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVersionSkew(): VersionSkew | null {
  return useSyncExternalStore(subscribe, () => skew);
}

/** Tests only: forget the recorded skew. */
export function resetVersionSkewForTests(): void {
  skew = null;
  lastApiVersion = null;
}

/** The message a refused response carries, for a screen that shows errors. */
export class VersionSkewError extends Error {
  constructor() {
    super(
      skew?.kind === 'reload'
        ? 'Hay una versión nueva de Ficha. Recargá para seguir.'
        : 'Estamos actualizando Ficha, probá en unos minutos.',
    );
    this.name = 'VersionSkewError';
  }
}
