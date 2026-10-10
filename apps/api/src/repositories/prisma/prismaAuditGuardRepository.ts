import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuditGuardRepository, AuditGuardResult } from '../auditGuardRepository';

// Every check file raises with this prefix; any other error means it did not
// get to run. Prisma quotes the database message in backticks.
const GUARD_FAILURE = /audit guards failed:[^`]*/;

export function createPrismaAuditGuardRepository(client: PrismaClient): AuditGuardRepository {
  return {
    async run(checkSql: string): Promise<AuditGuardResult> {
      try {
        await client.$executeRawUnsafe(checkSql);
        return { status: 'passed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = GUARD_FAILURE.exec(message);
        return failure
          ? { status: 'failed', message: failure[0].trim() }
          : { status: 'unreachable', message };
      }
    },
  };
}

export const prismaAuditGuardRepository = createPrismaAuditGuardRepository(prisma);
