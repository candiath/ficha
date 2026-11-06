import { Prisma } from '@prisma/client';
import type { TenantContext } from '../types';

// Clinical revisions (docs/specs/SPEC-clinical-revisions.md): every write to a
// clinical aggregate stores a snapshot of its new state, in the same transaction
// as the write and its audit row. The caller has locked the aggregate's root
// row, so `latest + 1` cannot race with another writer.

// A revision that could not be written, or read back. It rolls the action back.
// Its message holds a code, a table and an id and nothing else, and it carries no
// cause: Postgres puts the failing row, snapshot included, in the detail of a
// constraint error, and Prisma the arguments in a validation error (§11).
export class RevisionError extends Error {
  override name = 'RevisionError';
}

// The code of a failed write: Prisma's, or the SQLSTATE of an error Prisma does
// not map. Never its message.
function errorCode(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code;
  if (e instanceof Error) return /code: "([0-9A-Z]{5})"/.exec(e.message)?.[1] ?? e.name;
  return 'unknown';
}

interface RevisionFields {
  aggregateId: string;
  patientId: string;
  version: number;
  auditLogId: string;
  schemaVersion: number;
  snapshot: Prisma.InputJsonValue;
  reasonNote?: string | null;
}

type RevisionWriter = (tx: Prisma.TransactionClient, tenantId: string, fields: RevisionFields) => Promise<unknown>;

const WRITERS = {
  session_revisions: (tx, tenantId, { aggregateId, ...fields }) =>
    tx.sessionRevision.create({
      data: { ...fields, tenantId, sessionId: aggregateId },
      select: { id: true },
    }),
} as const satisfies Record<string, RevisionWriter>;

export type RevisionTable = keyof typeof WRITERS;

export async function recordRevision(
  tx: Prisma.TransactionClient,
  ctx: TenantContext,
  table: RevisionTable,
  fields: RevisionFields,
): Promise<void> {
  try {
    await WRITERS[table](tx, ctx.tenantId, fields);
  } catch (e) {
    const message = `revision write failed: code=${errorCode(e)} table=${table} id=${fields.aggregateId}`;
    console.error(message);
    throw new RevisionError(message);
  }
}
