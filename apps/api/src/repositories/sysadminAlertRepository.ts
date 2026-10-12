import type { SysadminAlertKind, SysadminAlertOutcome } from '@prisma/client';
import type { OperatorContext } from './types';

// Sysadmin alerts and their delivery attempts (#186,
// docs/specs/SPEC-sysadmin-alerts.md §5). Like auditGuardRepository and
// platformRepository it takes no ctx: an alert is about the platform, not a
// clinic. It touches only the two alert tables, and platform_audit_logs for
// the operator's test.

// Every kind but the operator's test: what the app itself raises.
export type RealAlertKind = Exclude<SysadminAlertKind, 'TEST'>;

export interface SysadminAlertDeliveryInput {
  outcome: SysadminAlertOutcome;
  // Telegram's error_code, only with REJECTED (a CHECK enforces it).
  errorCode: number | null;
  // Already redacted (lib/telegram.ts).
  detail: string | null;
}

export interface SysadminAlertDeliveryDTO {
  outcome: SysadminAlertOutcome;
  errorCode: number | null;
  detail: string | null;
  createdAt: string;
}

export interface SysadminAlertDTO {
  id: string;
  kind: SysadminAlertKind;
  createdAt: string;
  // How many attempts, and the latest. Delivery stops at the first SENT, so
  // an alert was delivered exactly when its latest attempt is SENT.
  deliveries: number;
  lastDelivery: SysadminAlertDeliveryDTO | null;
}

export interface SysadminAlertsOverviewData {
  // The last 20 real alerts, newest first. Tests are kept out, so a burst of
  // them cannot push a real alert out of view.
  alerts: SysadminAlertDTO[];
  lastTest: SysadminAlertDTO | null;
  // The latest attempt of any alert: the card's "último envío".
  lastDelivery: (SysadminAlertDeliveryDTO & { alertId: string; kind: SysadminAlertKind }) | null;
  // The banner: see undeliveredAlert().
  undeliveredAlert: SysadminAlertDTO | null;
}

export interface SysadminAlertRepository {
  createAlert(kind: RealAlertKind): Promise<{ id: string }>;
  // The TEST alert and its platform_audit_logs row (TEST_ALERT_SENT, no
  // clinic), in one transaction.
  createTestAlert(op: OperatorContext): Promise<{ id: string }>;
  recordDelivery(alertId: string, delivery: SysadminAlertDeliveryInput): Promise<void>;
  overview(now?: Date): Promise<SysadminAlertsOverviewData>;
}

// An alert with no attempt yet is in flight; past this, the process that
// raised it is gone (a deploy, a restart) and it never will be delivered.
// Longer than the retries take (§4: 5 s, then 30 s, or a 429's wait up to
// 60 s, with a 10 s timeout per attempt).
export const UNDELIVERED_AFTER_MS = 3 * 60 * 1000;

// The banner (Decision 4: literal, with no expiry): the most recent real
// alert, while it has not been delivered. Only a later real alert that is
// delivered clears it; a test never does.
export function undeliveredAlert(
  latestRealAlert: SysadminAlertDTO | null,
  now: Date,
): SysadminAlertDTO | null {
  if (!latestRealAlert) return null;
  const { lastDelivery, createdAt } = latestRealAlert;
  if (lastDelivery?.outcome === 'SENT') return null;
  if (lastDelivery) return latestRealAlert;
  return now.getTime() - new Date(createdAt).getTime() > UNDELIVERED_AFTER_MS ? latestRealAlert : null;
}
