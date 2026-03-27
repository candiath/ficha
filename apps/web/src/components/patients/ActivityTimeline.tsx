import {
  ClipboardList,
  CreditCard,
  FileText,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { auditLogApi, auditLogKeys } from '@/services/auditLog';

const ENTITY_CONFIG: Record<
  string,
  { icon: typeof ClipboardList; color: string; label: string }
> = {
  PATIENT: {
    icon: UserPlus,
    color:
      'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    label: 'Paciente',
  },
  EVALUATION: {
    icon: FileText,
    color:
      'bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400',
    label: 'Evaluación',
  },
  SESSION: {
    icon: Stethoscope,
    color:
      'bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400',
    label: 'Sesión',
  },
  PAYMENT: {
    icon: CreditCard,
    color:
      'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
    label: 'Cobro',
  },
  CONSENT: {
    icon: ShieldCheck,
    color:
      'bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
    label: 'Consentimiento',
  },
};

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Creación',
  UPDATED: 'Actualización',
  DELETED: 'Eliminación',
};

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  return {
    date: date.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

interface Props {
  patientId: string;
}

export default function ActivityTimeline({ patientId }: Props) {
  const { data: entries = [] } = useQuery({
    queryKey: auditLogKeys.list(patientId),
    queryFn: () => auditLogApi.list(patientId),
  });

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Historial de actividad</CardTitle>
        <p className="text-xs text-muted-foreground">
          Registro de cambios realizados en la ficha del paciente
        </p>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin actividad registrada.
          </p>
        ) : (
          <div className="relative ml-4">
            {/* Línea vertical */}
            <div className="absolute left-0 top-4 bottom-4 w-px bg-border" />

            <div className="space-y-0">
              {entries.map((entry, idx) => {
                const config = ENTITY_CONFIG[entry.entity] ?? ENTITY_CONFIG.PATIENT;
                const Icon = config.icon;
                const ts = formatTimestamp(entry.createdAt);
                const isLast = idx === entries.length - 1;

                return (
                  <div key={entry.id} className={cn('flex gap-4 relative', !isLast && 'pb-6')}>
                    {/* Dot */}
                    <div
                      className={cn(
                        'relative z-10 flex items-center justify-center w-8 h-8 rounded-full shrink-0 -ml-4',
                        config.color,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 font-normal"
                        >
                          {config.label}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 font-normal',
                            entry.action === 'CREATED'
                              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300'
                              : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
                          )}
                        >
                          {ACTION_LABELS[entry.action]}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {ts.date} · {ts.time}
                        </span>
                      </div>
                      <p className="text-sm">{entry.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
