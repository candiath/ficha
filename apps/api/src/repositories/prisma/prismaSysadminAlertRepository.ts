import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { OperatorContext } from '../types';
import {
  undeliveredAlert,
  type RealAlertKind,
  type SysadminAlertDeliveryInput,
  type SysadminAlertDTO,
  type SysadminAlertRepository,
  type SysadminAlertsOverviewData,
} from '../sysadminAlertRepository';
import { recordPlatformAudit } from './recordPlatformAudit';

// The base prisma client, like platformRepository: these tables have no
// clinic to scope by. Rows are only ever inserted; the triggers reject
// anything else.

const REAL_ALERTS_LISTED = 20;

const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] as const satisfies
  Prisma.SysadminAlertOrderByWithRelationInput[];

const deliverySelect = { outcome: true, errorCode: true, detail: true, createdAt: true } as const;

const alertSelect = {
  id: true,
  kind: true,
  createdAt: true,
  deliveries: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: deliverySelect },
  _count: { select: { deliveries: true } },
} satisfies Prisma.SysadminAlertSelect;

type AlertRow = Prisma.SysadminAlertGetPayload<{ select: typeof alertSelect }>;

function toAlertDTO(row: AlertRow): SysadminAlertDTO {
  const [last] = row.deliveries;
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    deliveries: row._count.deliveries,
    lastDelivery: last ? { ...last, createdAt: last.createdAt.toISOString() } : null,
  };
}

export const prismaSysadminAlertRepository: SysadminAlertRepository = {
  async createAlert(kind: RealAlertKind) {
    return prisma.sysadminAlert.create({ data: { kind }, select: { id: true } });
  },

  async createTestAlert(op: OperatorContext) {
    return prisma.$transaction(async (tx) => {
      const alert = await tx.sysadminAlert.create({
        data: { kind: 'TEST', operatorId: op.operatorId },
        select: { id: true },
      });
      // An action on the platform itself: no clinic, no target (#186).
      await recordPlatformAudit(tx, op, { action: 'TEST_ALERT_SENT', entityId: alert.id, params: {} });
      return alert;
    });
  },

  async recordDelivery(alertId: string, delivery: SysadminAlertDeliveryInput) {
    await prisma.sysadminAlertDelivery.create({ data: { alertId, ...delivery } });
  },

  async overview(now = new Date()): Promise<SysadminAlertsOverviewData> {
    const [alerts, lastTest, lastDelivery] = await Promise.all([
      prisma.sysadminAlert.findMany({
        where: { kind: { not: 'TEST' } },
        orderBy: newestFirst,
        take: REAL_ALERTS_LISTED,
        select: alertSelect,
      }),
      prisma.sysadminAlert.findFirst({ where: { kind: 'TEST' }, orderBy: newestFirst, select: alertSelect }),
      prisma.sysadminAlertDelivery.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { ...deliverySelect, alert: { select: { id: true, kind: true } } },
      }),
    ]);

    const realAlerts = alerts.map(toAlertDTO);
    return {
      alerts: realAlerts,
      lastTest: lastTest ? toAlertDTO(lastTest) : null,
      lastDelivery: lastDelivery
        ? {
            outcome: lastDelivery.outcome,
            errorCode: lastDelivery.errorCode,
            detail: lastDelivery.detail,
            createdAt: lastDelivery.createdAt.toISOString(),
            alertId: lastDelivery.alert.id,
            kind: lastDelivery.alert.kind,
          }
        : null,
      undeliveredAlert: undeliveredAlert(realAlerts[0] ?? null, now),
    };
  },
};
