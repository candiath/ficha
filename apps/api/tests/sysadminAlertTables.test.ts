import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  createTestClinic,
  createTestOperator,
  deleteSysadminAlerts,
  type TestClinic,
  type TestOperator,
} from './helpers';

// What the database enforces on the sysadmin alert tables (#186,
// docs/specs/SPEC-sysadmin-alerts.md §1–2): they are audit tables, with the
// same triggers as platform_audit_logs, plus CHECKs that tie each column to
// the kind of row that may carry it. Every assertion is on this file's own
// rows: other runs share these tables.

const APPEND_ONLY = /audit rows are append-only/;
const violates = (constraint: string) => new RegExp(`violates check constraint \\W*${constraint}`);

describe('sysadmin alert tables', () => {
  let operator: TestOperator;
  let clinic: TestClinic;
  const alertIds: string[] = [];

  const alert = async () => {
    const row = await prisma.sysadminAlert.create({
      data: { kind: 'AUDIT_GUARDS_FAILED' },
      select: { id: true },
    });
    alertIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    operator = await createTestOperator();
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    if (alertIds.length > 0) await deleteSysadminAlerts(alertIds);
    await operator.cleanup();
    await clinic.cleanup();
  });

  describe('are append-only', () => {
    it('reject updating an alert or a delivery', async () => {
      const { id } = await alert();
      const delivery = await prisma.sysadminAlertDelivery.create({
        data: { alertId: id, outcome: 'UNREACHABLE', detail: 'ECONNRESET' },
      });

      await expect(
        prisma.sysadminAlert.update({ where: { id }, data: { kind: 'TEST', operatorId: operator.operator.id } }),
      ).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.sysadminAlertDelivery.update({ where: { id: delivery.id }, data: { outcome: 'SENT', detail: null } }),
      ).rejects.toThrow(APPEND_ONLY);
    });

    it('reject deleting them outside maintenance', async () => {
      const { id } = await alert();
      const delivery = await prisma.sysadminAlertDelivery.create({ data: { alertId: id, outcome: 'SENT' } });

      await expect(prisma.sysadminAlertDelivery.delete({ where: { id: delivery.id } })).rejects.toThrow(APPEND_ONLY);
      await expect(
        prisma.sysadminAlertDelivery.deleteMany({ where: { alertId: id } }),
      ).rejects.toThrow(APPEND_ONLY);
      await expect(prisma.sysadminAlert.delete({ where: { id } })).rejects.toThrow(APPEND_ONLY);
    });

    it('let the test helper delete them under maintenance', async () => {
      const { id } = await prisma.sysadminAlert.create({ data: { kind: 'AUDIT_GUARDS_FAILED' } });
      await prisma.sysadminAlertDelivery.create({ data: { alertId: id, outcome: 'SENT' } });

      await deleteSysadminAlerts([id]);

      expect(await prisma.sysadminAlert.count({ where: { id } })).toBe(0);
      expect(await prisma.sysadminAlertDelivery.count({ where: { alertId: id } })).toBe(0);
    });

    it("stamp the database's time, whatever the caller sent", async () => {
      const { id } = await prisma.sysadminAlert.create({
        data: { kind: 'AUDIT_MAINTENANCE_FLAG_PRESENT', createdAt: new Date('2020-01-01T00:00:00Z') },
      });
      alertIds.push(id);
      const delivery = await prisma.sysadminAlertDelivery.create({
        data: { alertId: id, outcome: 'NOT_CONFIGURED', createdAt: new Date('2020-01-01T00:00:00Z') },
      });

      const [stored] = await prisma.$queryRaw<{ alertAge: number; deliveryAge: number }[]>`
        SELECT extract(epoch FROM (now() AT TIME ZONE 'UTC') - a.created_at)::float8 AS "alertAge",
               extract(epoch FROM (now() AT TIME ZONE 'UTC') - d.created_at)::float8 AS "deliveryAge"
        FROM sysadmin_alerts a JOIN sysadmin_alert_deliveries d ON d.alert_id = a.id
        WHERE d.id = ${delivery.id}::uuid`;
      expect(Math.abs(stored.alertAge)).toBeLessThan(60);
      expect(Math.abs(stored.deliveryAge)).toBeLessThan(60);
    });
  });

  describe('tie each column to its kind of row', () => {
    it('a test alert names its operator', async () => {
      await expect(prisma.sysadminAlert.create({ data: { kind: 'TEST' } })).rejects.toThrow(
        violates('sysadmin_alerts_operator_only_on_tests'),
      );
    });

    it('no other alert names one', async () => {
      await expect(
        prisma.sysadminAlert.create({ data: { kind: 'AUDIT_GUARDS_FAILED', operatorId: operator.operator.id } }),
      ).rejects.toThrow(violates('sysadmin_alerts_operator_only_on_tests'));
    });

    it("a rejection carries Telegram's code, and nothing else does", async () => {
      const { id } = await alert();

      await expect(
        prisma.sysadminAlertDelivery.create({ data: { alertId: id, outcome: 'REJECTED' } }),
      ).rejects.toThrow(violates('sysadmin_alert_deliveries_error_code_on_rejected'));
      await expect(
        prisma.sysadminAlertDelivery.create({ data: { alertId: id, outcome: 'SENT', errorCode: 200 } }),
      ).rejects.toThrow(violates('sysadmin_alert_deliveries_error_code_on_rejected'));
    });

    it('a delivery belongs to an alert that exists', async () => {
      await expect(
        prisma.sysadminAlertDelivery.create({
          data: { alertId: '01900000-0000-7000-8000-000000000000', outcome: 'SENT' },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('platform_audit_logs without a clinic', () => {
    it('takes the test alert, and only it', async () => {
      await prisma.platformAuditLog.create({
        data: {
          operatorId: operator.operator.id,
          action: 'TEST_ALERT_SENT',
        },
      });

      await expect(
        prisma.platformAuditLog.create({
          data: { operatorId: operator.operator.id, action: 'TENANT_CREATED' },
        }),
      ).rejects.toThrow(violates('platform_audit_logs_tenant_only_off_platform'));
      await expect(
        prisma.platformAuditLog.create({
          data: {
            operatorId: operator.operator.id,
            tenantId: clinic.tenantId,
            action: 'TEST_ALERT_SENT',
          },
        }),
      ).rejects.toThrow(violates('platform_audit_logs_tenant_only_off_platform'));
    });

    it('never with a target', async () => {
      const user = await clinic.createUser();

      await expect(
        prisma.platformAuditLog.create({
          data: {
            operatorId: operator.operator.id,
            targetUserId: user.id,
            action: 'TEST_ALERT_SENT',
          },
        }),
      ).rejects.toThrow(violates('platform_audit_logs_target_needs_tenant'));
    });
  });

  it('an operator who sent a test alert cannot be deleted', async () => {
    const other = await createTestOperator();
    try {
      await prisma.sysadminAlert.create({ data: { kind: 'TEST', operatorId: other.operator.id } });

      await expect(
        prisma.platformOperator.delete({ where: { id: other.operator.id } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    } finally {
      await other.cleanup();
    }
  });
});
