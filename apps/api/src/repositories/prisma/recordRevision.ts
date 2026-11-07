import { Prisma } from '@prisma/client';
import {
  CONSENT_SNAPSHOT_VERSION,
  ConsentSnapshotV1,
  EPISODE_SNAPSHOT_VERSION,
  EVALUATION_SNAPSHOT_VERSION,
  EpisodeSnapshotV1,
  EvaluationSnapshotV1,
  PATIENT_EVENT_SNAPSHOT_VERSION,
  PATIENT_SNAPSHOT_VERSION,
  PatientEventSnapshotV1,
  PatientSnapshotV1,
  SESSION_SNAPSHOT_VERSION,
  SessionSnapshotV1,
} from '@ficha/shared';
import type { z } from 'zod';
import type { TenantContext } from '../types';
import { sameValue } from './changedFields';

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

// Thrown inside a transaction to roll back what it wrote and answer `value`
// instead: a write that changed nothing leaves no trace (§5: a save that changes
// nothing writes nothing), and one refused after writing leaves none either.
// Caught by `unlessRolledBack`.
export class Rollback<T> extends Error {
  override name = 'Rollback';
  constructor(readonly value: T) {
    super('rolled back');
  }
}

// The transaction's result, or the value of a Rollback it threw.
export async function unlessRolledBack<T>(transaction: Promise<T>): Promise<T> {
  try {
    return await transaction;
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
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

type Tx = Prisma.TransactionClient;
type StoredRevision = { version: number; schemaVersion: number; snapshot: Prisma.JsonValue } | null;

const latest = { orderBy: { version: 'desc' }, select: { version: true, schemaVersion: true, snapshot: true } } as const;

// Per revisions table: how a version is written and the latest one read, and the
// schema its snapshot is parsed with. A patient is its own aggregate, so its
// revision's patient_id is the aggregate's id.
const TABLES = {
  session_revisions: {
    schema: SessionSnapshotV1,
    schemaVersion: SESSION_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, ...f }: RevisionFields) =>
      tx.sessionRevision.create({ data: { ...f, tenantId, sessionId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.sessionRevision.findFirst({ where: { tenantId, sessionId: id }, ...latest }),
  },
  patient_revisions: {
    schema: PatientSnapshotV1,
    schemaVersion: PATIENT_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, patientId: _patientId, ...f }: RevisionFields) =>
      tx.patientRevision.create({ data: { ...f, tenantId, patientId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.patientRevision.findFirst({ where: { tenantId, patientId: id }, ...latest }),
  },
  episode_revisions: {
    schema: EpisodeSnapshotV1,
    schemaVersion: EPISODE_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, ...f }: RevisionFields) =>
      tx.episodeRevision.create({ data: { ...f, tenantId, episodeId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.episodeRevision.findFirst({ where: { tenantId, episodeId: id }, ...latest }),
  },
  evaluation_revisions: {
    schema: EvaluationSnapshotV1,
    schemaVersion: EVALUATION_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, ...f }: RevisionFields) =>
      tx.evaluationRevision.create({ data: { ...f, tenantId, evaluationId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.evaluationRevision.findFirst({ where: { tenantId, evaluationId: id }, ...latest }),
  },
  consent_revisions: {
    schema: ConsentSnapshotV1,
    schemaVersion: CONSENT_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, ...f }: RevisionFields) =>
      tx.consentRevision.create({ data: { ...f, tenantId, consentId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.consentRevision.findFirst({ where: { tenantId, consentId: id }, ...latest }),
  },
  patient_event_revisions: {
    schema: PatientEventSnapshotV1,
    schemaVersion: PATIENT_EVENT_SNAPSHOT_VERSION,
    write: (tx: Tx, tenantId: string, { aggregateId, ...f }: RevisionFields) =>
      tx.patientEventRevision.create({ data: { ...f, tenantId, patientEventId: aggregateId }, select: { id: true } }),
    latest: (tx: Tx, tenantId: string, id: string): Promise<StoredRevision> =>
      tx.patientEventRevision.findFirst({ where: { tenantId, patientEventId: id }, ...latest }),
  },
} as const;

export type RevisionTable = keyof typeof TABLES;

export type SnapshotOf<T extends RevisionTable> = z.infer<(typeof TABLES)[T]['schema']>;

export interface LatestRevision<T extends RevisionTable> {
  version: number;
  snapshot: SnapshotOf<T>;
}

// The latest version of an aggregate, or null if it has none (version 0: written
// before revisions existed). The caller holds the aggregate's lock.
export async function latestRevision<T extends RevisionTable>(
  tx: Tx,
  tenantId: string,
  table: T,
  aggregateId: string,
): Promise<LatestRevision<T> | null> {
  const { schema, schemaVersion, latest: read } = TABLES[table];
  const revision = await read(tx, tenantId, aggregateId);
  if (!revision) return null;

  const parsed = schema.safeParse(revision.snapshot);
  if (revision.schemaVersion !== schemaVersion || !parsed.success) {
    throw new RevisionError(`revision unreadable: schema=${revision.schemaVersion} table=${table} id=${aggregateId}`);
  }
  return { version: revision.version, snapshot: parsed.data as SnapshotOf<T> };
}

// Whether a new projection differs from the latest version. An aggregate with
// none (version 0) is compared with the projection of its row before the write.
export function snapshotChanged<S>(latestSnapshot: S | undefined, before: S, after: S): boolean {
  return !sameValue(latestSnapshot ?? before, after);
}

export async function recordRevision<T extends RevisionTable>(
  tx: Tx,
  ctx: TenantContext,
  table: T,
  fields: Omit<RevisionFields, 'schemaVersion' | 'snapshot'> & { snapshot: SnapshotOf<T> },
): Promise<void> {
  const { write, schemaVersion } = TABLES[table];
  try {
    await write(tx, ctx.tenantId, {
      ...fields,
      schemaVersion,
      snapshot: fields.snapshot as Prisma.InputJsonValue,
    });
  } catch (e) {
    const message = `revision write failed: code=${errorCode(e)} table=${table} id=${fields.aggregateId}`;
    console.error(message);
    throw new RevisionError(message);
  }
}
