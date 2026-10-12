import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SessionFormDialog from '@/components/sessions/SessionFormModalWide';
import { SessionTypeBadge } from '@/components/sessions/SessionTypeBadge';
import { globalSessionApi, globalSessionKeys } from '@/services/globalSessions';
import { sessionApi, sessionKeys } from '@/services/sessions';
import type { SessionIndexItem } from '@/types/globalSession';

// Every session of the clinic, as an index: who and when (#186,
// SPEC-list-minimization.md §1). The list carries no clinical text, so a
// single request cannot take the whole clinic's notes; each session is read
// from its patient's route when it is opened.
export default function SessionsPage() {
  useEffect(() => { document.title = 'Sesiones'; }, []);
  const [selected, setSelected] = useState<SessionIndexItem | null>(null);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: globalSessionKeys.all,
    queryFn: globalSessionApi.list,
  });

  return (
    <div className="p-6 max-w-8xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Sesiones</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Historial de sesiones de todos los pacientes. El detalle clínico de cada una se lee en su
          ficha.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-lg">
          <CalendarDays className="h-10 w-10 mb-3 text-muted-foreground/30" />
          <p className="font-medium">Sin sesiones registradas</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Las sesiones aparecerán aquí a medida que las cargues desde el perfil de cada paciente.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const date = new Date(s.sessionDate);
                const formattedDate = date.toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'UTC',
                });
                return (
                  <TableRow key={s.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {formattedDate}
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/patients/${s.patient.id}?tab=sesiones`}
                        className="font-medium hover:underline"
                      >
                        {s.patient.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <SessionTypeBadge type={s.sessionType} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(s)}>
                        Ver detalles
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {selected && (
        <SessionDetail key={selected.id} item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// The session behind an index entry, read from its patient's route. Viewing
// and editing are the same form that created it, and that form renders only
// once the full session has arrived: fed the index entry, or nothing, it would
// open empty (or as a new session) and save every field it lacks as erased.
function SessionDetail({ item, onClose }: { item: SessionIndexItem; onClose: () => void }) {
  const { data: session, isError } = useQuery({
    queryKey: sessionKeys.detail(item.patient.id, item.id),
    queryFn: () => sessionApi.get(item.patient.id, item.id),
    retry: false,
  });

  if (isError) {
    // The index keeps naming a deleted patient's sessions (history, #72), but
    // the record is gone.
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>No se pudo abrir la sesión</DialogTitle>
            <DialogDescription>
              La ficha de este paciente ya no está disponible, o no se pudo cargar.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }
  if (!session) return null;

  return (
    <SessionFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      patientId={item.patient.id}
      session={session}
    />
  );
}
