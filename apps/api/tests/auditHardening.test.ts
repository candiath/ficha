import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
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
