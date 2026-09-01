import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { SESSION_TYPE_CLASS, SESSION_TYPE_LABELS } from '@/lib/labels';
import SessionFormDialog from '@/components/sessions/sessionFormModalWide';
import type { Session } from '@/types/session';

function PainScale({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const color =
    value <= 3
      ? 'text-green-600'
      : value <= 6
        ? 'text-amber-500'
        : 'text-destructive';
  return (
    <div className="text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-muted-foreground">/10</span>
    </div>
  );
}

function DetailSection({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

interface Props {
  session: Session | null;
  patientId: string;
  onClose: () => void;
}

export default function SessionDetailSheet({ session, patientId, onClose }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  if (!session) return null;

  const sessionDate = new Date(session.sessionDate);
  const formattedDate = sessionDate.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const formattedTime = sessionDate.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

  const hasPainData = session.painScaleBefore !== null || session.painScaleAfter !== null;

  return (
    <>
      <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle className="capitalize text-lg">{formattedDate}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{formattedTime} hs</p>
              </div>
              <Badge variant="outline" className={`shrink-0 ${SESSION_TYPE_CLASS[session.sessionType]}`}>
                {SESSION_TYPE_LABELS[session.sessionType]}
              </Badge>
            </div>
          </DialogHeader>

          <Separator />

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Escalas de dolor */}
            {hasPainData && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Escala de dolor
                </p>
                <div className="flex gap-8 justify-center py-2">
                  <PainScale value={session.painScaleBefore} label="Antes" />
                  {session.painScaleBefore !== null && session.painScaleAfter !== null && (
                  <div className="flex items-center text-muted-foreground text-lg">→</div>
                  )}
                  <PainScale value={session.painScaleAfter} label="Después" />
                </div>
              </div>
            )}

            {hasPainData && <Separator />}

            {/* Secciones de texto */}
            <div className="space-y-5">
              <DetailSection label="Estado pre-sesión" value={session.preSesionState} />
              <DetailSection label="Re-evaluación" value={session.reEvaluationNotes} />
              <DetailSection label="Respuesta del paciente" value={session.patientResponse} />
              <DetailSection label="Tratamiento" value={session.observations} />
            </div>

            {!hasPainData &&
              !session.preSesionState &&
              !session.reEvaluationNotes &&
              !session.patientResponse &&
              !session.observations && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Sin notas registradas para esta sesión.
                </p>
              )}
          </div>

          <Separator />

          {/* Footer */}
          <div className="px-6 py-4 flex justify-end shrink-0">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Editar sesión
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SessionFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        patientId={patientId}
        session={session}
      />
    </>
  );
}
