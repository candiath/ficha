import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, createTestOperator, sleep, type TestClinic, type TestOperator } from './helpers';

// The operator's change of a user's role or status is decided against the
// state it reads first, so it locks the row before reading it (area 3 review,
// L1): a change crossing another waits for it, then sees what it left.
describe("an operator's change of a user waits for a change in flight", () => {
  let clinic: TestClinic;
  let op: TestOperator;

  beforeAll(async () => {
    clinic = await createTestClinic();
    op = await createTestOperator();
  });

  afterAll(async () => {
    await clinic.cleanup();
    await op.cleanup();
  });

  it('records the reactivation that undoes a deactivation committed while it waited', async () => {
    const user = await clinic.createUser();

    // A first change in flight: the user deactivated, not yet committed.
    let commit!: () => void;
    const held = new Promise<void>((r) => (commit = r));
    let locked!: (pid: number) => void;
    const isLocked = new Promise<number>((r) => (locked = r));
    const first = prisma.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
        const [{ pid }] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
        locked(pid);
        await held;
      },
      { timeout: 20_000 },
    );
    const holder = await isLocked;

    const second = request(app)
      .patch(`/api/platform/tenants/${clinic.tenantId}/users/${user.id}`)
      .set('Authorization', `Bearer ${op.token}`)
      .send({ isActive: true });
    const response = second.then((r) => r);
    // Wait until the second change is blocked by this transaction: with the
    // lock it waits there before reading, without it only at its write, after
    // a stale read. Tied to this test's backend, as the container is shared.
    const blocked = async () => {
      const [{ count }] = await prisma.$queryRaw<[{ count: number }]>`
        SELECT count(*)::int AS count FROM pg_stat_activity WHERE ${holder}::int = ANY(pg_blocking_pids(pid))`;
      return count;
    };
    for (let i = 0; i < 400 && (await blocked()) < 1; i++) await sleep(25);
    commit();
    await first;

    expect((await response).status).toBe(200);
    // It saw the deactivation, so its reactivation is a change, and recorded.
    const rows = await prisma.platformAuditLog.findMany({
      where: { targetUserId: user.id },
      select: { action: true },
    });
    expect(rows.map((r) => r.action)).toEqual(['USER_REACTIVATED']);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { isActive: true } })).resolves.toEqual({
      isActive: true,
    });
  });
});
