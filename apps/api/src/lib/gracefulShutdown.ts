import type { Server } from 'node:http';

// How long a stopping API waits for its open requests before it exits anyway.
// Below compose.yaml's stop_grace_period (30 s), so the process ends on its own
// before Docker sends SIGKILL.
export const SHUTDOWN_TIMEOUT_MS = 25_000;

interface Options {
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: Pick<Console, 'log' | 'error'>;
  signals?: NodeJS.Signals[];
}

// On SIGTERM (`docker stop`, the end of a blue/green deploy) the API stops
// accepting connections and lets the requests in flight finish, then exits.
// Without it Node, as PID 1 in the container, ignores SIGTERM: it keeps
// serving until Docker kills it, and a request in progress is cut.
// Known limit: work a request starts after its response (a sysadmin alert's
// delivery, the no-show alert) is not awaited; the process exits once the
// last connection closes. A transaction cut that way rolls back.
// Returns the shutdown itself (tests call it instead of sending a signal) and
// a function that removes the signal handlers.
export function installGracefulShutdown(
  server: Server,
  options: Options = {},
): { shutdown: (signal: NodeJS.Signals) => void; dispose: () => void } {
  const {
    timeoutMs = SHUTDOWN_TIMEOUT_MS,
    exit = (code) => process.exit(code),
    log = console,
    signals = ['SIGTERM', 'SIGINT'],
  } = options;
  let stopping = false;

  const shutdown = (signal: NodeJS.Signals) => {
    // A second signal means "now" (Ctrl-C twice in dev).
    if (stopping) {
      log.error(`[api] ${signal} again: exiting without waiting`);
      exit(1);
      return;
    }
    stopping = true;
    log.log(`[api] ${signal}: closing, waiting for open requests`);
    const timer = setTimeout(() => {
      log.error(`[api] requests still open after ${timeoutMs} ms: exiting`);
      exit(1);
    }, timeoutMs);
    timer.unref();
    // close() drops the connections idle at that moment, but a keep-alive
    // connection whose request finishes later stays open, and the proxy keeps
    // its pool: without this the process would always wait for the timeout.
    const sweeper = setInterval(() => server.closeIdleConnections(), 250);
    sweeper.unref();
    server.close((error) => {
      clearTimeout(timer);
      clearInterval(sweeper);
      if (error) {
        log.error('[api] close failed:', error.message);
        exit(1);
        return;
      }
      log.log('[api] closed');
      exit(0);
    });
  };

  for (const signal of signals) process.on(signal, shutdown);
  return {
    shutdown,
    dispose: () => {
      for (const signal of signals) process.off(signal, shutdown);
    },
  };
}
