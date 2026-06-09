import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SessionDetailSheet from '@/components/sessions/SessionDetailSheet';
import { SESSION_TYPE_CLASS, SESSION_TYPE_LABELS } from '@/lib/labels';
import { globalSessionApi, globalSessionKeys } from '@/services/globalSessions';
import type { GlobalSession } from '@/types/globalSession';

function PainDelta({ before, after }: { before: number | null; after: number | null }) {
  if (before === null && after === null) return <span className="text-muted-foreground">—</span>;
  const display = `${before ?? '—'} → ${after ?? '—'}`;
  if (before !== null && after !== null && after < before) {
    return <span className="text-green-600 tabular-nums">{display}</span>;
  }
  if (before !== null && after !== null && after > before) {
    return <span className="text-destructive tabular-nums">{display}</span>;
  }
  return <span className="tabular-nums text-muted-foreground">{display}</span>;
}

export default function SessionsPage() {
  useEffect(() => { document.title = 'Sesiones'; }, []);
  const [selected, setSelected] = useState<GlobalSession | null>(null);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: globalSessionKeys.all,
    queryFn: globalSessionApi.list,
  });

  return (
    <div className="p-6 max-w-8xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Sesiones</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Historial de sesiones de todos los pacientes
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
                <TableHead>Episodio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Dolor (antes → desp.)</TableHead>
                <TableHead>Observaciones</TableHead>
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
                    <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                      {s.episode?.mainComplaint ?? <span className="italic">Sin episodio</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SESSION_TYPE_CLASS[s.sessionType]}>
                        {SESSION_TYPE_LABELS[s.sessionType]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <PainDelta before={s.painScaleBefore} after={s.painScaleAfter} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {s.observations ?? '—'}
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

      <SessionDetailSheet
        session={selected}
        patientId={selected?.patient.id ?? ''}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
