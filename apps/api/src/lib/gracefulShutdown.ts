import type { Server } from 'node:http';
import { backgroundWork as defaultBackgroundWork, type BackgroundWork } from './backgroundWork';

// How long a stopping API waits for its open requests before it exits anyway.
// Below compose.yaml's stop_grace_period (30 s), so the process ends on its own
// before Docker sends SIGKILL.
export const SHUTDOWN_TIMEOUT_MS = 25_000;

interface Options {
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: Pick<Console, 'log' | 'error'>;
  signals?: NodeJS.Signals[];
  background?: Pick<BackgroundWork, 'idle' | 'pending'>;
}

// On SIGTERM (`docker stop`, the end of a blue/green deploy) the API stops
// accepting connections and lets the requests in flight finish, then the work
// they left running (lib/backgroundWork.ts: a sysadmin alert's delivery, the
// no-show alert), then exits. Without it Node, as PID 1 in the container,
// ignores SIGTERM: it keeps serving until Docker kills it, and a request in
// progress is cut. What is still running at the timeout is cut: an alert's
// row is already written, and its delivery stays unconfirmed, which /platform
// shows; a transaction cut that way rolls back.
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
    background = defaultBackgroundWork,
  } = options;
  let stopping = false;
  let exited = false;
  // Exactly one exit: the timeout and the background work may both finish.
  const finish = (code: number) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  const shutdown = (signal: NodeJS.Signals) => {
    // A second signal means "now" (Ctrl-C twice in dev).
    if (stopping) {
      log.error(`[api] ${signal} again: exiting without waiting`);
      finish(1);
      return;
    }
    stopping = true;
    log.log(`[api] ${signal}: closing, waiting for open requests`);
    const timer = setTimeout(() => {
      log.error(`[api] requests or background work still open after ${timeoutMs} ms: exiting`);
      finish(1);
    }, timeoutMs);
    timer.unref();
    // close() drops the connections idle at that moment, but a keep-alive
    // connection whose request finishes later stays open, and the proxy keeps
    // its pool: without this the process would always wait for the timeout.
    const sweeper = setInterval(() => server.closeIdleConnections(), 250);
    sweeper.unref();
    server.close((error) => {
      clearInterval(sweeper);
      if (error) {
        clearTimeout(timer);
        log.error('[api] close failed:', error.message);
        finish(1);
        return;
      }
      const pending = background.pending();
      if (pending > 0) log.log(`[api] closed; waiting for ${pending} background task(s)`);
      void background.idle().then(() => {
        clearTimeout(timer);
        log.log('[api] closed');
        finish(0);
      });
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
