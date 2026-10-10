import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { auditGuardRepo } from '../src/repositories';
import { createPrismaAuditGuardRepository } from '../src/repositories/prisma/prismaAuditGuardRepository';

// The startup check tells a failed guarantee apart from a check that could
// not run (#186, SPEC-audit-hardening.md §1 "Checks").
describe('auditGuardRepo.run', () => {
  it('passes when the check raises nothing', async () => {
    await expect(auditGuardRepo.run('DO $$ BEGIN PERFORM 1; END $$')).resolves.toEqual({ status: 'passed' });
  });

  it('fails with the check\'s own message', async () => {
    const result = await auditGuardRepo.run(
      "DO $$ BEGIN RAISE EXCEPTION 'audit guards failed: trigger x is not enabled'; END $$",
    );
    expect(result).toEqual({ status: 'failed', message: 'audit guards failed: trigger x is not enabled' });
  });

  it('reports an unreachable database as unknown, not as failed', async () => {
    const nowhere = new PrismaClient({ datasourceUrl: 'postgresql://nobody:nothing@127.0.0.1:1/none' });
    try {
      const result = await createPrismaAuditGuardRepository(nowhere).run('SELECT 1');
      expect(result.status).toBe('unreachable');
    } finally {
      await nowhere.$disconnect();
    }
  });
});
