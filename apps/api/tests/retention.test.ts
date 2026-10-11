import { describe, expect, it, vi } from 'vitest';
import { runRetentionJobs, startRetention, type RetentionJob, type RetentionTimers } from '../src/lib/retention';
import { RETENTION_RUN_DELAY, RETENTION_RUN_INTERVAL } from '../src/lib/retentionPolicy';

// The retention runner (#178, docs/specs/SPEC-auth-session-cleanup.md): timers,
// batches and logging, tested on fake jobs and fake timers. No database.

const quietLog = () => ({ log: vi.fn(), error: vi.fn() });

// A job that deletes `backlog` rows, at most `batch` per call.
function fakeJob(name: string, backlog: number) {
  let left = backlog;
  const calls: number[] = [];
  const job: RetentionJob = {
    name,
    purgeBatch: (batch) => {
      const n = Math.min(batch, left);
      left -= n;
      calls.push(n);
      return Promise.resolve(n);
    },
  };
  return { job, calls, left: () => left };
}

// Timers that record what was scheduled and fire on demand.
function fakeTimers() {
  const unrefs: ReturnType<typeof vi.fn>[] = [];
  const scheduled: { kind: 'timeout' | 'interval'; ms: number; fn: () => void }[] = [];
  const handle = () => {
    const unref = vi.fn();
    unrefs.push(unref);
    return { unref };
  };
  const timers: RetentionTimers = {
    setTimeout: (fn, ms) => {
      scheduled.push({ kind: 'timeout', ms, fn });
      return handle();
    },
    setInterval: (fn, ms) => {
      scheduled.push({ kind: 'interval', ms, fn });
      return handle();
    },
  };
  return { timers, scheduled, unrefs };
}

describe('runRetentionJobs', () => {
  it('repeats while a batch comes back full, and stops at the cap', async () => {
    const big = fakeJob('big', 25);
    await runRetentionJobs([big.job], { batch: 5, maxBatches: 3, log: quietLog() });
    expect(big.calls).toEqual([5, 5, 5]);
    expect(big.left()).toBe(10);

    const small = fakeJob('small', 7);
    await runRetentionJobs([small.job], { batch: 5, maxBatches: 3, log: quietLog() });
    expect(small.calls).toEqual([5, 2]);
  });

  it('logs a job that throws, and still runs the others', async () => {
    const log = quietLog();
    const failing: RetentionJob = { name: 'failing', purgeBatch: () => Promise.reject(new Error('database asleep')) };
    const other = fakeJob('other', 3);

    await runRetentionJobs([failing, other.job], { batch: 5, maxBatches: 3, log });

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('failing'), expect.any(Error));
    expect(other.left()).toBe(0);
  });
});

describe('startRetention', () => {
  it('runs first after the delay, then every interval, with unref()ed timers', async () => {
    const job = fakeJob('sessions', 1_000_000);
    const { timers, scheduled, unrefs } = fakeTimers();
    const log = quietLog();

    startRetention([job.job], { timers, log, batch: 1, maxBatches: 1 });

    // Nothing runs before the delay.
    expect(job.calls).toEqual([]);
    expect(scheduled).toEqual([{ kind: 'timeout', ms: RETENTION_RUN_DELAY, fn: expect.any(Function) }]);

    scheduled[0].fn();
    // A run is over once it logs; one still in progress makes the next skip.
    await vi.waitFor(() => expect(log.log).toHaveBeenCalledTimes(1));
    expect(job.calls).toHaveLength(1);
    expect(scheduled[1]).toMatchObject({ kind: 'interval', ms: RETENTION_RUN_INTERVAL });

    scheduled[1].fn();
    await vi.waitFor(() => expect(log.log).toHaveBeenCalledTimes(2));
    expect(job.calls).toHaveLength(2);

    expect(unrefs).toHaveLength(2);
    for (const unref of unrefs) expect(unref).toHaveBeenCalled();
  });

  it('keeps its schedule after a run that fails', async () => {
    const log = quietLog();
    let attempts = 0;
    const flaky: RetentionJob = {
      name: 'flaky',
      purgeBatch: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve(0);
      },
    };
    const { timers, scheduled } = fakeTimers();

    startRetention([flaky], { timers, log, batch: 1, maxBatches: 1 });
    scheduled[0].fn();
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
    scheduled[1].fn();
    await vi.waitFor(() => expect(attempts).toBe(2));
  });
});
