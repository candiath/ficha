import { Prisma } from '@prisma/client';

// Which fields an update changed, for the `changedFields` parameter of the
// *_UPDATED audit actions (#186, SPEC-audit-structured-entries.md §4): names
// only, never values.
//
// The repository locks the row, reads it, writes, reads it again with the same
// select and compares. The lock makes the list exact: a concurrent edit waits
// for this transaction instead of slipping in between the read and the write.

// The tables whose updates are audited with changedFields, and the column a
// row is found by. A closed list: the name goes into raw SQL.
const LOCKABLE = {
  patients: 'id',
  sessions: 'id',
  payments: 'id',
  initial_evaluations: 'episode_id',
} as const;

type LockableTable = keyof typeof LOCKABLE;

// SELECT … FOR UPDATE on one row of a clinic. Raw SQL escapes the tenant-scope
// extension, so the tenant goes in the WHERE by hand.
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: LockableTable,
  key: string,
  tenantId: string,
): Promise<void> {
  const column = LOCKABLE[table];
  await tx.$queryRaw`SELECT 1 FROM ${Prisma.raw(`"${table}"`)} WHERE ${Prisma.raw(`"${column}"`)} = ${key}::uuid AND "tenant_id" = ${tenantId}::uuid FOR UPDATE`;
}

// A JSON value with its object keys sorted, so two equal grids compare equal
// whatever order their keys came back in.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

// The fields, among `fields`, whose value differs between the two reads. Both
// must come from the same select and mapping (dates as ISO strings, decimals as
// numbers), so equal values serialize equally.
export function changedFields<F extends string>(
  before: Readonly<Record<F, unknown>>,
  after: Readonly<Record<F, unknown>>,
  fields: readonly F[],
): F[] {
  return fields.filter((f) => canonical(before[f]) !== canonical(after[f]));
}

// A list with at least one element, or null: an update that changed nothing
// records no audit row.
export function nonEmpty<F>(list: F[]): [F, ...F[]] | null {
  return list.length > 0 ? (list as [F, ...F[]]) : null;
}
