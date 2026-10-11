import { readFileSync } from 'node:fs';
import path from 'node:path';
import { auditGuardRepo } from '../repositories';
import type { AuditGuardRepository } from '../repositories/auditGuardRepository';
import type { RealAlertKind } from '../repositories/sysadminAlertRepository';
import { sysadminAlerts } from './sysadminAlerts';

// The audit checks again at startup (#186, SPEC-audit-hardening.md §1
// "Checks"): the Render build already refused a database whose guarantees
// changed, but one can change after the deploy, and Render free restarts the
// API after every idle period. This only logs and alerts; it never blocks the
// server. no-audit-maintenance runs only in production, since development
// carries the flag on purpose.
//
// A failed check alerts the sysadmin (SPEC-sysadmin-alerts.md §7). One that
// could not run does not: a Neon cold start would page her for nothing.
//
// Resolved from this file, so it works from src/ (ts-node-dev) and dist/ (node).
const CHECKS_DIR = path.join(__dirname, '..', '..', 'prisma');

const CHECKS: { file: string; alert: RealAlertKind; productionOnly: boolean }[] = [
  { file: 'audit-guards.sql', alert: 'AUDIT_GUARDS_FAILED', productionOnly: false },
  { file: 'no-audit-maintenance.sql', alert: 'AUDIT_MAINTENANCE_FLAG_PRESENT', productionOnly: true },
];

export interface StartupCheckOptions {
  log?: Pick<Console, 'log' | 'error'>;
  guards?: AuditGuardRepository;
  raise?: (kind: RealAlertKind) => Promise<void>;
  production?: boolean;
}

export async function checkAuditGuardsAtStartup({
  log = console,
  guards = auditGuardRepo,
  raise = (kind) => sysadminAlerts.raise(kind),
  production = process.env.NODE_ENV === 'production',
}: StartupCheckOptions = {}): Promise<void> {
  for (const { file, alert, productionOnly } of CHECKS) {
    if (productionOnly && !production) continue;

    const result = await guards.run(readFileSync(path.join(CHECKS_DIR, file), 'utf8'));
    if (result.status === 'passed') {
      log.log(`[audit] ${file}: passed`);
    } else if (result.status === 'failed') {
      log.error(`[audit] ${file}: FAILED — ${result.message}`);
      // raise never rejects; this catch is the second line, so no alert path
      // can become an unhandled rejection, a crash and a restart loop.
      try {
        await raise(alert);
      } catch {
        log.error(`[audit] ${file}: could not raise the alert`);
      }
    } else {
      log.error(`[audit] ${file}: could not check — ${result.message}`);
    }
  }
}
