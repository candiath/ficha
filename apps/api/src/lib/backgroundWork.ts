// Work the API starts and does not await: a sysadmin alert's delivery, the
// no-show alert a request records after answering. Each one is tracked here so
// a stopping API (gracefulShutdown.ts) waits for it, within its timeout,
// instead of exiting with it half done.

export interface BackgroundWork {
  // Tracks the work and returns it. A rejection is the caller's to handle: the
  // tracker only waits for it to settle.
  track<T>(work: Promise<T>): Promise<T>;
  // Resolves once nothing tracked is pending, including work tracked while it
  // waits.
  idle(): Promise<void>;
  pending(): number;
}

export function createBackgroundWork(): BackgroundWork {
  const running = new Set<Promise<unknown>>();

  return {
    track(work) {
      const settled = work.then(
        () => undefined,
        () => undefined,
      );
      running.add(settled);
      void settled.then(() => running.delete(settled));
      return work;
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
    pending: () => running.size,
  };
}

export const backgroundWork = createBackgroundWork();
