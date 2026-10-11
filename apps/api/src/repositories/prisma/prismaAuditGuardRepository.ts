import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { AuditGuardRepository, AuditGuardResult } from '../auditGuardRepository';

// Every check file raises with this prefix. Prisma quotes the database
// message in backticks.
const GUARD_FAILURE = /audit guards failed:[^`]*/;

// The errors that mean the check never reached the database: a cold start
// timing out, the server unreachable or closing the connection. Only these
// are "could not check". Anything else is a failure, because a database that
// errors on the check (a dropped audit table, a missing function) has lost a
// guarantee just as surely as one that fails it (SPEC-sysadmin-alerts.md §7).
const CONNECTION_ERRORS = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

function isConnectionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && CONNECTION_ERRORS.has(error.code))
  );
}

export function createPrismaAuditGuardRepository(client: PrismaClient): AuditGuardRepository {
  return {
    async run(checkSql: string): Promise<AuditGuardResult> {
      try {
        await client.$executeRawUnsafe(checkSql);
        return { status: 'passed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isConnectionError(error)) return { status: 'unreachable', message };
        const failure = GUARD_FAILURE.exec(message);
        return { status: 'failed', message: failure ? failure[0].trim() : message };
      }
    },
  };
}

export const prismaAuditGuardRepository = createPrismaAuditGuardRepository(prisma);
