import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient, type User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { createTestAuthSession, createTestClinic, deleteAuditRows, type TestClinic } from './helpers';

// What the database itself enforces on audit rows (#186,
// docs/specs/SPEC-audit-hardening.md): they cannot be changed, only deleted
// under maintenance, and their time is the database's. These tests touch the
// shared tables only with row-level operations on their own clinic.

const APPEND_ONLY = /audit rows are append-only/;

describe('audit rows are append-only', () => {
  let clinic: TestClinic;
  let user: User;
  let authSessionId: string;
  let patientId: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    ({ authSessionId } = await createTestAuthSession(user));
    ({ id: patientId } = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Hardened Patient' },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  const row = (overrides: { createdAt?: Date; description?: string } = {}) => ({
    tenantId: clinic.tenantId,
    patientId,
    userId: user.id,
    authSessionId,
    entity: 'PATIENT' as const,
    entityId: patientId,
    action: 'UPDATED' as const,
    description: 'test: hardened row',
    ...overrides,
  });

  const insert = (overrides?: Parameters<typeof row>[0]) =>
    prisma.auditLog.create({ data: row(overrides), select: { id: true } });

  it('rejects an update', async () => {
    const { id } = await insert();

    await expect(
      prisma.auditLog.update({ where: { id }, data: { description: 'test: rewritten' } }),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it('rejects a delete, single or many, outside maintenance', async () => {
    const { id } = await insert();

    await expect(prisma.auditLog.delete({ where: { id } })).rejects.toThrow(APPEND_ONLY);
    await expect(
      prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } }),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it('lets the test helper delete under maintenance', async () => {
    const other = await createTestClinic();
    try {
      const author = await other.createUser();
      const session = await createTestAuthSession(author);
      const patient = await prisma.patient.create({
        data: { tenantId: other.tenantId, fullName: 'Purged Patient' },
        select: { id: true },
      });
      await prisma.auditLog.create({
        data: {
          ...row(),
          tenantId: other.tenantId,
          patientId: patient.id,
          entityId: patient.id,
          userId: author.id,
          authSessionId: session.authSessionId,
        },
      });

      await deleteAuditRows([other.tenantId]);

      expect(await prisma.auditLog.count({ where: { tenantId: other.tenantId } })).toBe(0);
      await prisma.patient.delete({ where: { id: patient.id } });
    } finally {
      await other.cleanup();
    }
  });

  it("stamps the database's current UTC time, whatever the caller sent", async () => {
    const { id } = await insert({ createdAt: new Date('2020-01-01T00:00:00Z') });

    const [stored] = await prisma.$queryRaw<{ age: number }[]>`
      SELECT extract(epoch FROM (now() AT TIME ZONE 'UTC') - created_at)::float8 AS age
      FROM audit_logs WHERE id = ${id}::uuid`;
    // now() is the start of this query's transaction, a moment after the
    // insert: the age is small, and never the six years the caller asked for.
    expect(Math.abs(stored.age)).toBeLessThan(60);
  });

  // The insert's own time, not its transaction's start: two rows written
  // apart inside one transaction keep that gap.
  it('stamps each insert of a transaction with its own time', async () => {
    const [first, second] = await prisma.$transaction(async (tx) => {
      const a = await tx.auditLog.create({ data: row(), select: { id: true } });
      await tx.$executeRaw`SELECT pg_sleep(0.05)`;
      const b = await tx.auditLog.create({ data: row(), select: { id: true } });
      return [a, b];
    });

    const [{ gap }] = await prisma.$queryRaw<{ gap: number }[]>`
      SELECT extract(epoch FROM b.created_at - a.created_at)::float8 AS gap
      FROM audit_logs a, audit_logs b
      WHERE a.id = ${first.id}::uuid AND b.id = ${second.id}::uuid`;
    expect(gap).toBeGreaterThanOrEqual(0.04);
  });
});

// The switch and the flag, probed on one backend: a single-connection client
// over the direct URL (the pooler would hand each statement to any backend),
// and a TEMP table carrying the real trigger function, so nothing shared is
// truncated or deleted.
describe('maintenance needs the flag and a switch tied to the transaction', () => {
  const url = new URL(process.env.DIRECT_DATABASE_URL as string);
  url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasourceUrl: url.toString() });

  const SWITCH_ON = Prisma.sql`SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`;
  const deleteProbe = (tx: Prisma.TransactionClient | PrismaClient) =>
    tx.$executeRaw`DELETE FROM pg_temp.audit_probe`;

  beforeAll(async () => {
    await db.$executeRaw`CREATE TEMP TABLE audit_probe (id int)`;
    await db.$executeRaw`CREATE TRIGGER audit_probe_append_only BEFORE UPDATE OR DELETE ON pg_temp.audit_probe
      FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only()`;
    await db.$executeRaw`CREATE TRIGGER audit_probe_no_truncate BEFORE TRUNCATE ON pg_temp.audit_probe
      FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only()`;
  });

  afterAll(async () => {
    await db.$executeRaw`RESET ficha.audit_maintenance`;
    await db.$disconnect();
  });

  const refill = () => db.$executeRaw`INSERT INTO pg_temp.audit_probe VALUES (1)`;

  it('deletes with the flag and the switch (the probe works)', async () => {
    await refill();
    const deleted = await db.$transaction(async (tx) => {
      await tx.$queryRaw(SWITCH_ON);
      return deleteProbe(tx);
    });
    expect(deleted).toBeGreaterThan(0);
  });

  it('never truncates, even under maintenance', async () => {
    await refill();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw(SWITCH_ON);
        await tx.$executeRaw`TRUNCATE pg_temp.audit_probe`;
      }),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it('ignores a switch set to any other value', async () => {
    await refill();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('ficha.audit_maintenance', 'on', true)`;
        await deleteProbe(tx);
      }),
    ).rejects.toThrow(APPEND_ONLY);
  });

  it('ignores a switch set at session level', async () => {
    await refill();
    // The value is the id of this statement's own transaction: right for it,
    // wrong for every later one.
    await db.$queryRaw`SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, false)`;
    try {
      await expect(deleteProbe(db)).rejects.toThrow(APPEND_ONLY);
    } finally {
      await db.$executeRaw`RESET ficha.audit_maintenance`;
    }
  });

  it('does not outlive the transaction that set it, on the same backend', async () => {
    await refill();
    const pid = await db.$transaction(async (tx) => {
      await tx.$queryRaw(SWITCH_ON);
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      return row.pid;
    });

    const [{ pid: samePid }] = await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    expect(samePid).toBe(pid);
    await expect(deleteProbe(db)).rejects.toThrow(APPEND_ONLY);
  });

  // The only lock this suite takes on a shared object: the flag table, which
  // nothing else writes, dropped inside a transaction that always rolls back.
  it('does nothing without the flag', async () => {
    await refill();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$queryRaw(SWITCH_ON);
        await tx.$executeRaw`DROP TABLE ficha_ops.audit_maintenance_allowed`;
        await deleteProbe(tx);
      }),
    ).rejects.toThrow(APPEND_ONLY);

    const [{ flagged }] = await db.$queryRaw<{ flagged: boolean }[]>`
      SELECT to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL AS flagged`;
    expect(flagged).toBe(true);
  });
});

// A session on an audit row is a real session of its author when the row is
// written (spec §1 and §3). A null session still passes: the code that
// predates #186 writes none.
describe("the session on an audit row is its author's", () => {
  const NOT_HERS = /audit row names a session that is not its author's/;
  let clinic: TestClinic;
  let author: User;
  let colleague: User;
  let authorSession: string;
  let colleagueSession: string;
  let patientId: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    author = await clinic.createUser();
    colleague = await clinic.createUser();
    ({ authSessionId: authorSession } = await createTestAuthSession(author));
    ({ authSessionId: colleagueSession } = await createTestAuthSession(colleague));
    ({ id: patientId } = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Session Checked Patient' },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  const row = (userId: string | null, authSessionId: string | null) => ({
    tenantId: clinic.tenantId,
    patientId,
    userId,
    authSessionId,
    entity: 'PATIENT' as const,
    entityId: patientId,
    action: 'UPDATED' as const,
    description: 'test: session checked',
  });

  it("accepts the author's own session, or none", async () => {
    await expect(prisma.auditLog.create({ data: row(author.id, authorSession) })).resolves.toBeTruthy();
    await expect(prisma.auditLog.create({ data: row(author.id, null) })).resolves.toBeTruthy();
  });

  it("rejects a colleague's session", async () => {
    await expect(prisma.auditLog.create({ data: row(author.id, colleagueSession) })).rejects.toThrow(
      NOT_HERS,
    );
  });

  it('rejects a session that does not exist, or one with no author', async () => {
    await expect(prisma.auditLog.create({ data: row(author.id, randomUUID()) })).rejects.toThrow(NOT_HERS);
    await expect(prisma.auditLog.create({ data: row(null, authorSession) })).rejects.toThrow(NOT_HERS);
  });

  it('is not fooled by a TEMP table named auth_sessions', async () => {
    const url = new URL(process.env.DIRECT_DATABASE_URL as string);
    url.searchParams.set('connection_limit', '1');
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      const forged = randomUUID();
      await db.$executeRaw`CREATE TEMP TABLE auth_sessions (id uuid, user_id uuid)`;
      await db.$executeRaw`INSERT INTO pg_temp.auth_sessions VALUES (${forged}::uuid, ${author.id}::uuid)`;
      // Unqualified, this name now resolves to the TEMP table for this backend.
      const [{ seen }] = await db.$queryRaw<{ seen: bigint }[]>`
        SELECT count(*) AS seen FROM auth_sessions WHERE id = ${forged}::uuid`;
      expect(seen).toBe(1n);

      await expect(db.auditLog.create({ data: row(author.id, forged) })).rejects.toThrow(NOT_HERS);
    } finally {
      await db.$disconnect();
    }
  });
});
