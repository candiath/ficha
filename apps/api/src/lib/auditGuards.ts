import { readFileSync } from 'node:fs';
import path from 'node:path';
import { auditGuardRepo } from '../repositories';

// The audit checks again at startup (#186, SPEC-audit-hardening.md §1
// "Checks"): the Render build already refused a database whose guarantees
// changed, but one can change after the deploy, and Render free restarts the
// API after every idle period. This only logs; it never blocks the server.
// no-audit-maintenance runs only in production, since development carries the
// flag on purpose. Once sysadmin-alerts exists, a failure alerts.
//
// Resolved from this file, so it works from src/ (tsx) and dist/ (node).
const CHECKS_DIR = path.join(__dirname, '..', '..', 'prisma');

export async function checkAuditGuardsAtStartup(
  log: Pick<Console, 'log' | 'error'> = console,
): Promise<void> {
  const files = ['audit-guards.sql'];
  if (process.env.NODE_ENV === 'production') files.push('no-audit-maintenance.sql');

  for (const file of files) {
    const result = await auditGuardRepo.run(readFileSync(path.join(CHECKS_DIR, file), 'utf8'));
    if (result.status === 'passed') {
      log.log(`[audit] ${file}: passed`);
    } else if (result.status === 'failed') {
      log.error(`[audit] ${file}: FAILED — ${result.message}`);
    } else {
      log.error(`[audit] ${file}: could not check — ${result.message}`);
    }
  }
}
