import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  createOperatorTestSession,
  createTestClinic,
  createTestOperator,
  type TestClinic,
  type TestOperator,
} from './helpers';

// Why an operator session ended, and which session wrote each platform audit
// row (SPEC-operator-sessions.md, SPEC-audit-hardening.md "Decisions" 2).
describe('operator session evidence', () => {
  let op: TestOperator;
  let other: TestOperator;
  let clinic: TestClinic;

  beforeAll(async () => {
    op = await createTestOperator();
    other = await createTestOperator();
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    await clinic.cleanup();
    await other.cleanup();
    await op.cleanup();
  });

  it('a platform audit row names the session the action came from', async () => {
    const second = await createOperatorTestSession(op.operator);
    const res = await request(app)
      .patch(`/api/platform/tenants/${clinic.tenantId}`)
      .set('Authorization', `Bearer ${second.token}`)
      .send({ active: false });
    expect(res.status).toBe(200);

    const row = await prisma.platformAuditLog.findFirstOrThrow({
      where: { operatorId: op.operator.id, tenantId: clinic.tenantId, action: 'TENANT_DEACTIVATED' },
    });
    expect(row.operatorSessionId).toBe(second.operatorSessionId);
  });

  // The trigger, not only the code: a row cannot name another operator's
  // session, or one that does not exist.
  it("the database refuses a row naming a session that is not its operator's", async () => {
    const insert = (operatorSessionId: string) =>
      prisma.platformAuditLog.create({
        data: {
          operatorId: op.operator.id,
          tenantId: clinic.tenantId,
          action: 'TENANT_REACTIVATED',
          operatorSessionId,
        },
      });
    await expect(insert(other.operatorSessionId)).rejects.toThrow(/not its operator's/);
    await expect(insert('01900000-0000-7000-8000-000000000000')).rejects.toThrow(/not its operator's/);
  });

  it('a revoked session says why, and only a revoked one has a reason', async () => {
    const s = await createOperatorTestSession(op.operator);
    const update = (data: { revokedAt?: Date | null; revocationReason?: 'LOGOUT' | null }) =>
      prisma.platformOperatorSession.update({ where: { id: s.operatorSessionId }, data });

    await expect(update({ revokedAt: new Date() })).rejects.toThrow(/reason_iff_revoked/);
    await expect(update({ revocationReason: 'LOGOUT' })).rejects.toThrow(/reason_iff_revoked/);
    await expect(update({ revokedAt: new Date(), revocationReason: 'LOGOUT' })).resolves.toBeTruthy();
  });
});
