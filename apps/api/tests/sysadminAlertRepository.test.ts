import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { sysadminAlertRepo } from '../src/repositories';
import {
  UNDELIVERED_AFTER_MS,
  undeliveredAlert,
  type SysadminAlertDTO,
} from '../src/repositories/sysadminAlertRepository';
import { createTestOperator, deleteSysadminAlerts, type TestOperator } from './helpers';

// The alert repository (#186, docs/specs/SPEC-sysadmin-alerts.md §5). The
// tables are shared with other runs, so the database tests assert only on
// their own alerts; the banner rule is a pure function, tested apart.

describe('sysadminAlertRepo', () => {
  let operator: TestOperator;
  const alertIds: string[] = [];

  beforeAll(async () => {
    operator = await createTestOperator();
  });

  afterAll(async () => {
    if (alertIds.length > 0) await deleteSysadminAlerts(alertIds);
    await operator.cleanup();
  });

  it('records a test alert and the operator action, with no clinic', async () => {
    const { id } = await sysadminAlertRepo.createTestAlert({ operatorId: operator.operator.id });

    const alert = await prisma.sysadminAlert.findUniqueOrThrow({ where: { id } });
    expect(alert).toMatchObject({ kind: 'TEST', operatorId: operator.operator.id });
    const actions = await prisma.platformAuditLog.findMany({
      where: { operatorId: operator.operator.id, action: 'TEST_ALERT_SENT' },
    });
    expect(actions).toEqual([
      // The row names the alert it sent.
      expect.objectContaining({ tenantId: null, targetUserId: null, entity: 'SYSADMIN_ALERT', entityId: id }),
    ]);
  });

  it('lists a real alert with its latest attempt and their count, and keeps tests apart', async () => {
    const { id } = await sysadminAlertRepo.createAlert('AUDIT_GUARDS_FAILED');
    alertIds.push(id);
    await sysadminAlertRepo.recordDelivery(id, { outcome: 'UNREACHABLE', errorCode: null, detail: 'TimeoutError' });
    await sysadminAlertRepo.recordDelivery(id, {
      outcome: 'REJECTED',
      errorCode: 429,
      detail: 'Too Many Requests: retry after 90',
    });
    const test = await sysadminAlertRepo.createTestAlert({ operatorId: operator.operator.id });
    await sysadminAlertRepo.recordDelivery(test.id, { outcome: 'SENT', errorCode: null, detail: null });

    const overview = await sysadminAlertRepo.overview();

    const listed = overview.alerts.find((a) => a.id === id);
    expect(listed).toMatchObject({
      kind: 'AUDIT_GUARDS_FAILED',
      deliveries: 2,
      lastDelivery: { outcome: 'REJECTED', errorCode: 429, detail: 'Too Many Requests: retry after 90' },
    });
    expect(overview.alerts.map((a) => a.id)).not.toContain(test.id);
    expect(overview.alerts.length).toBeLessThanOrEqual(20);
    expect(overview.lastTest?.kind).toBe('TEST');
    expect(overview.lastDelivery).not.toBeNull();
  });
});

describe('undeliveredAlert', () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const alert = (
    lastDelivery: SysadminAlertDTO['lastDelivery'],
    createdAt = '2026-10-11T11:59:00Z',
  ): SysadminAlertDTO => ({
    id: '01900000-0000-7000-8000-000000000001',
    kind: 'AUDIT_GUARDS_FAILED',
    createdAt,
    deliveries: lastDelivery ? 1 : 0,
    lastDelivery,
  });
  const delivery = (outcome: 'SENT' | 'REJECTED' | 'UNREACHABLE' | 'NOT_CONFIGURED') => ({
    outcome,
    errorCode: outcome === 'REJECTED' ? 401 : null,
    detail: null,
    createdAt: '2026-10-11T11:59:30Z',
  });

  it('shows the latest real alert while it has not been delivered', () => {
    for (const outcome of ['REJECTED', 'UNREACHABLE', 'NOT_CONFIGURED'] as const) {
      const failed = alert(delivery(outcome));
      expect(undeliveredAlert(failed, now)).toBe(failed);
    }
  });

  it('shows nothing once it was delivered', () => {
    expect(undeliveredAlert(alert(delivery('SENT')), now)).toBeNull();
  });

  it('shows nothing when there is no real alert', () => {
    expect(undeliveredAlert(null, now)).toBeNull();
  });

  // The process that raised it died before recording any attempt.
  it('shows an alert with no attempt once it is past its retries, not before', () => {
    const fresh = alert(null, new Date(now.getTime() - UNDELIVERED_AFTER_MS + 1000).toISOString());
    const stale = alert(null, new Date(now.getTime() - UNDELIVERED_AFTER_MS - 1000).toISOString());

    expect(undeliveredAlert(fresh, now)).toBeNull();
    expect(undeliveredAlert(stale, now)).toBe(stale);
  });

  it('does not expire', () => {
    const old = alert(delivery('UNREACHABLE'), '2025-01-01T00:00:00Z');
    expect(undeliveredAlert(old, now)).toBe(old);
  });
});
