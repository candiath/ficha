import { setInterval as nodeSetInterval, setTimeout as nodeSetTimeout } from 'node:timers';
import { authRepo } from '../repositories';
import {
  RETENTION_BATCH,
  RETENTION_MAX_BATCHES,
  RETENTION_RUN_DELAY,
  RETENTION_RUN_INTERVAL,
  authSessionCleanupCutoffs,
} from './retentionPolicy';

// Purges data past its retention (docs/specs/audit-map.md, decision 8;
// docs/specs/SPEC-auth-session-cleanup.md). Render free has no cron and
// sleeps when idle, so nothing can run at a fixed hour: the runner starts
// RETENTION_RUN_DELAY after the server listens, then every
// RETENTION_RUN_INTERVAL while the process lives. Never on a request.
//
// Each job deletes in batches; a new kind of data to purge is a new job here
// (login_events in security-events), not new timers.

export interface RetentionJob {
  name: string;
  // Deletes at most `batch` rows; returns how many it deleted.
  purgeBatch(batch: number): Promise<number>;
}

export const authSessionRetentionJob: RetentionJob = {
  name: 'auth_sessions',
  purgeBatch: (batch) => authRepo.deleteEndedAuthSessions({ ...authSessionCleanupCutoffs(new Date()), batch }),
};

interface Unrefable {
  unref(): unknown;
}

export interface RetentionTimers {
  setTimeout(fn: () => void, ms: number): Unrefable;
  setInterval(fn: () => void, ms: number): Unrefable;
}

const nodeTimers: RetentionTimers = {
  setTimeout: (fn, ms) => nodeSetTimeout(fn, ms),
  setInterval: (fn, ms) => nodeSetInterval(fn, ms),
};

interface RunOptions {
  batch?: number;
  maxBatches?: number;
  log?: Pick<Console, 'log' | 'error'>;
}

// One pass over every job: batches while they come back full, up to the cap.
// A job that fails is logged and skipped; the others still run.
export async function runRetentionJobs(jobs: RetentionJob[], options: RunOptions = {}): Promise<void> {
  const { batch = RETENTION_BATCH, maxBatches = RETENTION_MAX_BATCHES, log = console } = options;
  for (const job of jobs) {
    try {
      let deleted = 0;
      for (let i = 0; i < maxBatches; i++) {
        const n = await job.purgeBatch(batch);
        deleted += n;
        if (n < batch) break;
      }
      log.log(`[retention] ${job.name}: deleted ${deleted}`);
    } catch (error) {
      log.error(`[retention] ${job.name}: failed, retried at the next run`, error);
    }
  }
}

// Schedules the runs. Timers are unref()ed: they never keep the process alive
// or delay a shutdown. A run still in progress makes the next one skip.
export function startRetention(
  jobs: RetentionJob[],
  options: RunOptions & { timers?: RetentionTimers } = {},
): void {
  const { timers = nodeTimers, ...runOptions } = options;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runRetentionJobs(jobs, runOptions);
    } finally {
      running = false;
    }
  };
  timers
    .setTimeout(() => {
      void run();
      timers.setInterval(() => void run(), RETENTION_RUN_INTERVAL).unref();
    }, RETENTION_RUN_DELAY)
    .unref();
}
