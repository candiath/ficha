import type { SysadminAlertDelivery, SysadminAlertKind } from '@ficha/shared';

// How the Alertas card and the banner name an alert and its delivery (#186).
// Typed with the union: a kind the API adds fails the typecheck here instead
// of showing the raw enum.
export const ALERT_KIND_LABELS: Record<SysadminAlertKind, string> = {
  AUDIT_GUARDS_FAILED: 'Chequeo de auditoría fallido',
  AUDIT_MAINTENANCE_FLAG_PRESENT: 'Marca de mantenimiento de auditoría presente',
  TEST: 'Alerta de prueba',
};

type DeliveryResult = Pick<SysadminAlertDelivery, 'outcome' | 'errorCode'>;

export function deliveryLabel(delivery: DeliveryResult | null): string {
  if (!delivery) return 'Sin intentos registrados';
  switch (delivery.outcome) {
    case 'SENT':
      return 'Enviada';
    case 'REJECTED':
      return `Rechazada por Telegram (${delivery.errorCode})`;
    case 'UNREACHABLE':
      return 'No se pudo contactar a Telegram';
    case 'NOT_CONFIGURED':
      return 'No configurado';
  }
}

export function formatAlertDate(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
