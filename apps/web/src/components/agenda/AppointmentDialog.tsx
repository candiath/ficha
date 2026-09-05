import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import type { Appointment } from '@ficha/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addMinutesToTime, formatLongDate, overlaps } from '@/lib/agendaDates';
import { appointmentApi, appointmentKeys } from '@/services/appointments';
import { episodeApi, episodeKeys } from '@/services/episodes';
import { patientApi, patientKeys } from '@/services/patients';

const DURACIONES = [30, 45, 60, 90];

export default function AppointmentDialog({
  open,
  onClose,
  date,
  time,
  /** Los turnos del mismo día, para avisar si el horario ya está ocupado. */
  sameDay,
}: {
  open: boolean;
  onClose: () => void;
  date: string;
  time: string;
  sameDay: Appointment[];
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        {/* key: al abrir sobre otro hueco el formulario se remonta con esa
            fecha y hora, en vez de sincronizarse con un efecto. */}
        {open && (
          <NewAppointmentForm
            key={`${date}T${time}`}
            date={date}
            time={time}
            sameDay={sameDay}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewAppointmentForm({
  date,
  time,
  sameDay,
  onClose,
}: {
  date: string;
  time: string;
  sameDay: Appointment[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [patientId, setPatientId] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [startTime, setStartTime] = useState(time);
  const [durationMinutes, setDuration] = useState(60);
  const [repite, setRepite] = useState(false);
  const [everyWeeks, setEveryWeeks] = useState(1);
  const [occurrences, setOccurrences] = useState(10);
  const [notes, setNotes] = useState('');

  const { data: patients = [] } = useQuery({
    queryKey: patientKeys.all,
    queryFn: patientApi.list,
  });

  // Los episodios se piden recién cuando hay paciente: agendar sin motivo de
  // consulta es válido, así que esto es opcional y no bloquea el formulario.
  const { data: episodes = [] } = useQuery({
    queryKey: episodeKeys.list(patientId),
    queryFn: () => episodeApi.list(patientId),
    enabled: !!patientId,
  });

  const activos = episodes.filter((e) => e.status === 'ACTIVE');
  const endTime = addMinutesToTime(startTime, durationMinutes);

  // Solapar está permitido —sobreturnos, una reprogramación de apuro— así que
  // esto avisa y no bloquea. Se calcula acá y no en la API porque la pantalla
  // ya tiene el día cargado: no hace falta preguntar nada.
  const pisados = sameDay.filter(
    (a) =>
      a.status !== 'CANCELLED' &&
      overlaps(startTime, endTime, a.startTime, a.endTime),
  );

  const error = !patientId ? 'Elegí un paciente' : null;

  const mutation = useMutation({
    mutationFn: () =>
      appointmentApi.create({
        patientId,
        episodeId: episodeId || null,
        notes: notes.trim() || null,
        date,
        time: startTime,
        durationMinutes,
        ...(repite ? { repeat: { everyWeeks, occurrences } } : {}),
      }),
    onSuccess: (creados) => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      toast.success(
        creados.length === 1 ? 'Turno agendado' : `${creados.length} turnos agendados`,
      );
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'Error al agendar el turno'),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nuevo turno</DialogTitle>
        <DialogDescription>{formatLongDate(date)}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Paciente</Label>
          <Select
            value={patientId}
            onValueChange={(v) => {
              if (v === null) return;
              setPatientId(v as string);
              // El episodio elegido era de otro paciente: se limpia solo.
              setEpisodeId('');
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elegir paciente" />
            </SelectTrigger>
            <SelectContent>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {activos.length > 0 && (
          <div className="space-y-1.5">
            <Label>
              Motivo <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Select
              value={episodeId}
              onValueChange={(v) => v !== null && setEpisodeId(v as string)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin motivo asignado" />
              </SelectTrigger>
              <SelectContent>
                {activos.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.mainComplaint || 'Sin motivo'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ap-time">Hora</Label>
            <Input
              id="ap-time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Duración</Label>
            <Select
              value={String(durationMinutes)}
              onValueChange={(v) => v !== null && setDuration(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURACIONES.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} minutos
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          De {startTime} a {endTime}.
        </p>

        {/* Botón y no checkbox: el Checkbox de Base UI hace saltar el scroll
            del modal al tope. */}
        <div className="rounded-lg border border-border p-3 space-y-3">
          <button
            type="button"
            onClick={() => setRepite((v) => !v)}
            aria-pressed={repite}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <span
              className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                repite ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
              }`}
            >
              {repite && '✓'}
            </span>
            Repetir
          </button>

          {repite && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Cada</Label>
                  <Select
                    value={String(everyWeeks)}
                    onValueChange={(v) => v !== null && setEveryWeeks(Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 semana</SelectItem>
                      <SelectItem value="2">2 semanas</SelectItem>
                      <SelectItem value="3">3 semanas</SelectItem>
                      <SelectItem value="4">4 semanas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ap-veces">Cantidad</Label>
                  <Input
                    id="ap-veces"
                    type="number"
                    min="2"
                    max="52"
                    value={occurrences}
                    onChange={(e) => setOccurrences(Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Se agendan {occurrences} turnos. Después vas a poder cancelar los que
                queden sin tocar los que ya se atendieron.
              </p>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ap-notes">
            Notas <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Textarea
            id="ap-notes"
            rows={2}
            placeholder="Ej: primera consulta, traer estudios"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {pisados.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p className="text-xs">
              A esa hora ya hay {pisados.length === 1 ? 'un turno' : `${pisados.length} turnos`}:{' '}
              {pisados.map((a) => `${a.startTime} ${a.patientName}`).join(', ')}. Podés
              agendarlo igual.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!!error || mutation.isPending}>
          {mutation.isPending ? 'Agendando...' : 'Agendar'}
        </Button>
      </DialogFooter>
    </>
  );
}
