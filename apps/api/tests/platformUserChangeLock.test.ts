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
    await clinic.createUser({ role: 'ADMIN' }); // the clinic keeps an active ADMIN
    const user = await clinic.createUser();

    // A first change in flight: the user deactivated, not yet committed.
    let commit!: () => void;
    const held = new Promise<void>((r) => (commit = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const first = prisma.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    const second = request(app)
      .patch(`/api/platform/tenants/${clinic.tenantId}/users/${user.id}`)
      .set('Authorization', `Bearer ${op.token}`)
      .send({ isActive: true });
    const response = second.then((r) => r);
    await sleep(200); // the second change is now waiting on the user's row
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
