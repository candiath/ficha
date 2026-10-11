import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { platformAlertKeys, platformAlertsApi } from '@/services/platform';
import { ALERT_KIND_LABELS, formatAlertDate } from './alertLabels';

// Across every /platform page (#186, SPEC-sysadmin-alerts.md §10): the most
// recent real alert did not arrive by Telegram. The API decides when
// (undeliveredAlert): until a later real alert is delivered; a test never
// clears it. Same query as the Alertas card, so one request serves both.
export default function UndeliveredAlertBanner() {
  const { data } = useQuery({
    queryKey: platformAlertKeys.overview,
    queryFn: platformAlertsApi.overview,
  });
  const alert = data?.undeliveredAlert;
  if (!alert) return null;

  return (
    <div role="alert" className="border-b border-destructive/30 bg-destructive/10 text-destructive">
      <div className="mx-auto max-w-4xl px-4 py-2 text-sm flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          La última alerta no llegó por Telegram ({formatAlertDate(alert.createdAt)},{' '}
          {ALERT_KIND_LABELS[alert.kind]}).{' '}
          <Link to="/platform/tenants#alertas" className="underline underline-offset-2">
            Revisá la tarjeta Alertas.
          </Link>
        </p>
      </div>
    </div>
  );
}
