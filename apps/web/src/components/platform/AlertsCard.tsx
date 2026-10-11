import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { BellRing, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { SysadminAlertBot, SysadminAlertsOverview } from '@ficha/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { platformAlertKeys, platformAlertsApi } from '@/services/platform';
import { ALERT_KIND_LABELS, deliveryLabel, formatAlertDate } from './alertLabels';

// The operator's view of the alert channel (#186,
// docs/specs/SPEC-sysadmin-alerts.md §10): whether Telegram is configured
// and with which bot, the last delivery, a test that waits for Telegram, and
// the last real alerts. The API never sends the token or the chat id; this
// shows a status and the names of the variables.
export default function AlertsCard() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: platformAlertKeys.overview,
    queryFn: platformAlertsApi.overview,
  });
  const configured = data?.configuration === 'configured';
  const bot = useQuery({
    queryKey: platformAlertKeys.bot,
    queryFn: platformAlertsApi.bot,
    enabled: configured,
  });

  const sendTest = useMutation({
    mutationFn: platformAlertsApi.sendTest,
    onSettled: () => queryClient.invalidateQueries({ queryKey: platformAlertKeys.overview }),
    onError: (error) => toast.error(error.message),
  });

  // The banner links here (/platform/tenants#alertas); the router does not
  // scroll to a hash by itself.
  useEffect(() => {
    if (location.hash === '#alertas' && data) cardRef.current?.scrollIntoView({ block: 'start' });
  }, [location.hash, data]);

  const testResult = sendTest.data ?? data?.lastTest?.lastDelivery ?? null;

  return (
    <Card id="alertas" ref={cardRef}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            Alertas
          </CardTitle>
          {data && (
            <Badge variant="outline" className="text-xs font-mono">
              {data.environment}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Avisos por Telegram a quien administra la plataforma. Nunca llevan datos de pacientes ni
          de personas.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
        {isError && <p className="text-sm text-destructive">No se pudieron cargar las alertas.</p>}

        {data && (
          <>
            <div className="space-y-1 text-sm">
              <ConfigurationLine overview={data} bot={bot.data} botLoading={bot.isLoading} />
              <p className="text-muted-foreground">
                Último envío:{' '}
                {data.lastDelivery ? (
                  <span className="text-foreground">
                    {formatAlertDate(data.lastDelivery.createdAt)} · {ALERT_KIND_LABELS[data.lastDelivery.kind]} ·{' '}
                    {deliveryLabel(data.lastDelivery)}
                  </span>
                ) : (
                  'ninguno todavía.'
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!configured || sendTest.isPending}
                onClick={() => sendTest.mutate()}
              >
                <Send className="h-4 w-4" />
                {sendTest.isPending ? 'Enviando…' : 'Enviar alerta de prueba'}
              </Button>
              {testResult && !sendTest.isPending && (
                <p className="text-sm" aria-live="polite">
                  <span className={cn(testResult.outcome === 'SENT' ? 'text-foreground' : 'text-destructive')}>
                    {sendTest.data ? 'Resultado' : 'Última prueba'}: {deliveryLabel(testResult)}
                  </span>
                  {testResult.detail && testResult.outcome !== 'SENT' && (
                    <span className="text-muted-foreground"> — {testResult.detail}</span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground" id="ultimas-alertas">
                Últimas alertas
              </p>
              {data.alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ninguna alerta todavía.</p>
              ) : (
                <ul className="divide-y text-sm" aria-labelledby="ultimas-alertas">
                  {data.alerts.map((alert) => (
                    <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="font-medium">{ALERT_KIND_LABELS[alert.kind]}</p>
                        <p className="text-xs text-muted-foreground">{formatAlertDate(alert.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {alert.deliveries > 1 && (
                          <span className="text-muted-foreground">{alert.deliveries} intentos</span>
                        )}
                        <Badge
                          variant={alert.lastDelivery?.outcome === 'SENT' ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {deliveryLabel(alert.lastDelivery)}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigurationLine({
  overview,
  bot,
  botLoading,
}: {
  overview: SysadminAlertsOverview;
  bot: SysadminAlertBot | undefined;
  botLoading: boolean;
}) {
  const names = overview.variables;
  if (overview.configuration === 'not_configured') {
    return (
      <p className="text-destructive">
        No configurado: {names.length === 1 ? 'falta' : 'faltan'} {names.join(' y ')} en el servicio.
      </p>
    );
  }
  if (overview.configuration === 'invalid') {
    return <p className="text-destructive">Configuración inválida: {names.join(', ')}.</p>;
  }
  if (botLoading || !bot) return <p>Configurado · verificando el bot…</p>;
  if (bot.status === 'ok') return <p>Configurado · bot @{bot.username}</p>;
  if (bot.status === 'error') {
    return (
      <p className="text-destructive">
        No se pudo verificar el bot (
        {bot.errorCode ? `Telegram respondió ${bot.errorCode}` : (bot.detail ?? 'sin respuesta')}).
      </p>
    );
  }
  return <p>Configurado</p>;
}
