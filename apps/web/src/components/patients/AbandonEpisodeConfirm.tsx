import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { describeClockSkew, serverNow, useClockSkewMinutes } from '@/lib/serverClock';
import { episodeApi } from '@/services/episodes';

interface AbandonEpisodeConfirmProps {
  patientId: string;
  episodeId: string;
  // The version on screen: closing an episode someone changed meanwhile is a 409.
  episodeVersion: number;
  onCancel: () => void;
  onAbandoned: () => void;
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// What the API answers when a closing falls before the opening.
function closedBeforeOpened(error: unknown): { openedAt: string; serverTime: string } | null {
  if (!(error instanceof ApiError) || error.body.code !== 'closed_before_opened') return null;
  const { openedAt, serverTime } = error.body;
  return typeof openedAt === 'string' && typeof serverTime === 'string' ? { openedAt, serverTime } : null;
}

// The closing time is on screen before it is sent, and what is sent is what the
// screen says: by the API's clock, which this device's may not match. If the
// API refuses it, the user sees why and decides; nothing is resent on its own.
export default function AbandonEpisodeConfirm({
  patientId,
  episodeId,
  episodeVersion,
  onCancel,
  onAbandoned,
}: AbandonEpisodeConfirmProps) {
  const [closingAt, setClosingAt] = useState(serverNow);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const skewMinutes = useClockSkewMinutes();

  const mutation = useMutation({
    mutationFn: () =>
      episodeApi.update(patientId, episodeId, {
        status: 'ABANDONED',
        closedAt: closingAt.toISOString(),
        expectedVersion: episodeVersion,
      }),
    onSuccess: onAbandoned,
    onError: (error: Error) => {
      const refusal = closedBeforeOpened(error);
      if (!refusal) {
        setProblem(error.message);
        return;
      }
      if (new Date(refusal.serverTime) < new Date(refusal.openedAt)) {
        // No clock problem: the opening is dated ahead of the real time.
        setBlocked(true);
        setProblem(`El episodio abre el ${formatDateTime(refusal.openedAt)}: no se puede cerrar antes de esa fecha.`);
        return;
      }
      setClosingAt(new Date(refusal.serverTime));
      setProblem(
        `Esa hora es anterior a la apertura del episodio (${formatDateTime(refusal.openedAt)}): ` +
          'la hora de este dispositivo no coincide con la del servidor. ' +
          'Ahora figura la hora real; confirmá para registrar el cierre con ella.',
      );
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>¿Marcar como abandonado?</DialogTitle>
        <DialogDescription>
          El episodio se cerrará sin alta formal. El paciente no tiene sesiones de cierre registradas.
          Podrás reactivarlo en cualquier momento.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 text-sm">
        <p>
          Fecha de cierre: <span className="font-medium">{formatDateTime(closingAt)}</span>
        </p>
        {skewMinutes !== 0 && (
          <p className="text-muted-foreground">
            Es la hora del servidor: la de este dispositivo está {describeClockSkew(skewMinutes)}.
          </p>
        )}
        {problem && (
          <p role="alert" className="text-destructive">
            {problem}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending || blocked}>
          {mutation.isPending ? 'Guardando...' : 'Confirmar abandono'}
        </Button>
      </DialogFooter>
    </>
  );
}
