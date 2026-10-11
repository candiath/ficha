import { describe, expect, it } from 'vitest';
import { checkAuditGuardsAtStartup } from '../src/lib/auditGuards';
import type { AuditGuardRepository, AuditGuardResult } from '../src/repositories/auditGuardRepository';
import type { RealAlertKind } from '../src/repositories/sysadminAlertRepository';

// The audit check at startup is the first producer of sysadmin alerts (#186,
// docs/specs/SPEC-sysadmin-alerts.md §7): a failed check alerts, a check that
// could not run does not. No database: the checks and the alert are fakes.

function guardsReturning(byFile: Record<string, AuditGuardResult>): AuditGuardRepository {
  return {
    run: (sql) => {
      // Only no-audit-maintenance.sql names the flag table.
      const file = sql.includes('ficha_ops.audit_maintenance_allowed') ? 'no-audit-maintenance.sql' : 'audit-guards.sql';
      return Promise.resolve(byFile[file] ?? { status: 'passed' });
    },
  };
}

function run(byFile: Record<string, AuditGuardResult>, opts: { production?: boolean; raise?: (kind: RealAlertKind) => Promise<void> } = {}) {
  const raised: RealAlertKind[] = [];
  const lines: string[] = [];
  const done = checkAuditGuardsAtStartup({
    log: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    guards: guardsReturning(byFile),
    raise: opts.raise ?? ((kind) => {
      raised.push(kind);
      return Promise.resolve();
    }),
    production: opts.production ?? true,
  });
  return { done, raised, lines };
}

describe('checkAuditGuardsAtStartup', () => {
  it('raises AUDIT_GUARDS_FAILED when audit-guards.sql fails', async () => {
    const { done, raised } = run({
      'audit-guards.sql': { status: 'failed', message: 'audit guards failed: trigger x is not enabled' },
    });
    await done;

    expect(raised).toEqual(['AUDIT_GUARDS_FAILED']);
  });

  it('raises AUDIT_MAINTENANCE_FLAG_PRESENT when the flag is found in production', async () => {
    const { done, raised } = run({
      'no-audit-maintenance.sql': { status: 'failed', message: 'audit guards failed: flag' },
    });
    await done;

    expect(raised).toEqual(['AUDIT_MAINTENANCE_FLAG_PRESENT']);
  });

  it('does not look for the flag outside production, where development carries it', async () => {
    const { done, raised } = run(
      { 'no-audit-maintenance.sql': { status: 'failed', message: 'audit guards failed: flag' } },
      { production: false },
    );
    await done;

    expect(raised).toEqual([]);
  });

  it('raises nothing when the checks pass, or could not run', async () => {
    const passed = run({});
    const unreachable = run({
      'audit-guards.sql': { status: 'unreachable', message: 'timeout' },
      'no-audit-maintenance.sql': { status: 'unreachable', message: 'timeout' },
    });
    await Promise.all([passed.done, unreachable.done]);

    expect(passed.raised).toEqual([]);
    expect(unreachable.raised).toEqual([]);
  });

  // An alert path must never become an unhandled rejection, a crash and a
  // restart loop.
  it('survives an alert that rejects, and logs it without its message', async () => {
    const { done, lines } = run(
      { 'audit-guards.sql': { status: 'failed', message: 'audit guards failed: x' } },
      { raise: () => Promise.reject(new Error('secret-looking detail')) },
    );

    await expect(done).resolves.toBeUndefined();
    expect(lines.join('\n')).toMatch(/could not raise the alert/);
    expect(lines.join('\n')).not.toContain('secret-looking detail');
  });
});
