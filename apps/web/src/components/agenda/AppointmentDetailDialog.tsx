import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarX, Check, FileText, Repeat, User, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Appointment, AppointmentStatus } from '@ficha/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import SessionFormModalWide from '@/components/sessions/sessionFormModalWide';
import { formatLongDate } from '@/lib/agendaDates';
import { APPOINTMENT_STATUS_CLASS, APPOINTMENT_STATUS_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { appointmentApi, appointmentKeys } from '@/services/appointments';

export default function AppointmentDetailDialog({
  appointment,
  onClose,
}: {
  appointment: Appointment | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [registrando, setRegistrando] = useState(false);

  const invalidar = () =>
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all });

  const cambiarEstado = useMutation({
    mutationFn: (status: AppointmentStatus) => {
      if (!appointment) throw new Error('No hay turno');
      return appointmentApi.update(appointment.id, { status });
    },
    onSuccess: () => {
      invalidar();
      toast.success('Turno actualizado');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'Error al actualizar el turno'),
  });

  const cancelarSerie = useMutation({
    mutationFn: () => {
      if (!appointment) throw new Error('No hay turno');
      return appointmentApi.cancelSeries(appointment.id);
    },
    onSuccess: ({ cancelled }) => {
      invalidar();
      toast.success(
        cancelled === 0
          ? 'No quedaban turnos por cancelar'
          : `${cancelled} turno${cancelled === 1 ? '' : 's'} cancelado${cancelled === 1 ? '' : 's'}`,
      );
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'Error al cancelar la serie'),
  });

  const pendiente = cambiarEstado.isPending || cancelarSerie.isPending;
  const a = appointment;

  return (
    <Dialog open={!!a} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        {a && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {a.startTime} – {a.endTime}
                <Badge
                  variant="outline"
                  className={cn('text-[10px]', APPOINTMENT_STATUS_CLASS[a.status])}
                >
                  {APPOINTMENT_STATUS_LABELS[a.status]}
                </Badge>
              </DialogTitle>
              <DialogDescription>{formatLongDate(a.date)}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Link
                to={`/patients/${a.patientId}`}
                className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
              >
                <User className="h-4 w-4 shrink-0" />
                {a.patientName}
              </Link>

              {a.episodeMainComplaint && (
                <p className="text-sm text-muted-foreground">{a.episodeMainComplaint}</p>
              )}

              {a.notes && <p className="text-sm">{a.notes}</p>}

              {a.seriesId && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Repeat className="h-3.5 w-3.5 shrink-0" />
                  Parte de una serie de turnos repetidos
                </p>
              )}
            </div>

            <Separator />

            {/* El punto de tener agenda: el turno ya sabe quién, cuándo y por
                qué motivo, así que registrar la sesión no vuelve a pedir nada
                de eso. Si ya se registró, el botón desaparece — la API
                rechaza el segundo intento igual, pero mejor no ofrecerlo. */}
            {a.sessionId ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" />
                La sesión de este turno ya está registrada.
              </p>
            ) : (
              <Button
                className="w-full"
                disabled={pendiente}
                onClick={() => setRegistrando(true)}
              >
                <FileText className="h-4 w-4 mr-2" />
                Vino: registrar la sesión
              </Button>
            )}

            <Separator />

            {/* Las tres respuestas posibles a "¿qué pasó con este turno?".
                Confirmado es previo: el paciente avisó que viene. */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pendiente || a.status === 'CONFIRMED'}
                onClick={() => cambiarEstado.mutate('CONFIRMED')}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                Confirmó
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pendiente || a.status === 'CANCELLED'}
                onClick={() => cambiarEstado.mutate('CANCELLED')}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Canceló
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pendiente || a.status === 'NO_SHOW'}
                onClick={() => cambiarEstado.mutate('NO_SHOW')}
              >
                <CalendarX className="h-3.5 w-3.5 mr-1" />
                No vino
              </Button>
            </div>

            {a.seriesId && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={pendiente}
                    onClick={() => cancelarSerie.mutate()}
                  >
                    Cancelar los turnos que quedan de la serie
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Solo los que todavía no ocurrieron. Los que ya se atendieron quedan
                    como están.
                  </p>
                </div>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
            </DialogFooter>

            {/* El mismo formulario de siempre, con paciente, fecha y motivo ya
                cargados desde el turno. Al guardar, la API vincula los dos en
                una transacción y el turno queda como atendido. */}
            {registrando && (
              <SessionFormModalWide
                open
                onOpenChange={(v) => !v && setRegistrando(false)}
                patientId={a.patientId}
                episodeId={a.episodeId ?? undefined}
                appointment={a}
                onSuccess={() => {
                  setRegistrando(false);
                  onClose();
                }}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
