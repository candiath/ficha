import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarOff,
  Check,
  Clock,
  CreditCard,
  Filter,
  MessageCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { alertApi, alertKeys } from '@/services/alerts';

type AlertType = 'FOLLOW_UP' | 'NO_SHOW' | 'PAYMENT' | 'CUSTOM';

const ALERT_CONFIG: Record<
  AlertType,
  { icon: typeof Bell; label: string; color: string; badgeClass: string }
> = {
  FOLLOW_UP: {
    icon: Clock,
    label: 'Seguimiento',
    color: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    badgeClass:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  NO_SHOW: {
    icon: CalendarOff,
    label: 'Inasistencia',
    color: 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400',
    badgeClass:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
  },
  PAYMENT: {
    icon: CreditCard,
    label: 'Pago pendiente',
    color: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  CUSTOM: {
    icon: MessageCircle,
    label: 'Personalizada',
    color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    badgeClass:
      'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
  },
};

type FilterType = 'all' | AlertType;

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('all');

  const { data: alerts = [] } = useQuery({
    queryKey: alertKeys.all,
    queryFn: () => alertApi.list(),
  });

  const { data: stats } = useQuery({
    queryKey: alertKeys.stats,
    queryFn: alertApi.stats,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => alertApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.all });
      queryClient.invalidateQueries({ queryKey: alertKeys.stats });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => alertApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: alertKeys.all });
      queryClient.invalidateQueries({ queryKey: alertKeys.stats });
    },
  });

  const unreadCount = stats?.unread ?? 0;

  const filtered =
    filter === 'all' ? alerts : alerts.filter((a) => a.type === filter);

  const filterOptions: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'FOLLOW_UP', label: 'Seguimiento' },
    { value: 'NO_SHOW', label: 'Inasistencias' },
    { value: 'PAYMENT', label: 'Pagos' },
    { value: 'CUSTOM', label: 'Otras' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Alertas clínicas
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Seguimiento automático de pacientes y cobros
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
            <Check className="h-4 w-4 mr-1.5" />
            Marcar todas como leídas
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: 'Sin leer',
            value: unreadCount,
            color: 'text-destructive',
            bg: 'bg-destructive/10',
          },
          {
            label: 'Seguimiento',
            value: stats?.followUp ?? 0,
            color: 'text-blue-600 dark:text-blue-400',
            bg: 'bg-blue-100 dark:bg-blue-950',
          },
          {
            label: 'Pagos',
            value: stats?.payment ?? 0,
            color: 'text-amber-600 dark:text-amber-400',
            bg: 'bg-amber-100 dark:bg-amber-950',
          },
          {
            label: 'Inasistencias',
            value: stats?.noShow ?? 0,
            color: 'text-red-600 dark:text-red-400',
            bg: 'bg-red-100 dark:bg-red-950',
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <div
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                  stat.bg,
                )}
              >
                <span className={cn('text-lg font-bold', stat.color)}>
                  {stat.value}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-tight">
                {stat.label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {filterOptions.map((opt) => (
          <Button
            key={opt.value}
            variant={filter === opt.value ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilter(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <Separator />

      {/* Lista de alertas */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Bell className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-medium">Sin alertas</p>
          <p className="text-sm text-muted-foreground mt-1">
            No hay alertas {filter !== 'all' ? 'de este tipo' : ''} en este
            momento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => {
            const config = ALERT_CONFIG[alert.type as AlertType];
            const Icon = config?.icon ?? Bell;
            const date = new Date(alert.createdAt);

            return (
              <Card
                key={alert.id}
                className={cn(
                  'transition-colors',
                  !alert.isRead && 'border-l-2 border-l-primary bg-primary/[0.02]',
                )}
              >
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    {/* Icono */}
                    <div
                      className={cn(
                        'flex items-center justify-center w-9 h-9 rounded-full shrink-0',
                        config.color,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Contenido */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', config?.badgeClass)}>
                          {config?.label ?? alert.type}
                        </Badge>
                        {!alert.isRead && (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        )}
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          {date.toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      <p className="text-sm">{alert.message}</p>

                      <div className="flex items-center gap-3 mt-2">
                        {alert.patientName && (
                          <Link
                            to={`/patients/${alert.patientId}`}
                            className="text-xs text-primary hover:underline font-medium"
                          >
                            Ver ficha de {alert.patientName.split(' ')[0]}
                          </Link>
                        )}
                        {!alert.isRead && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => markReadMutation.mutate(alert.id)}
                          >
                            Marcar como leída
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
