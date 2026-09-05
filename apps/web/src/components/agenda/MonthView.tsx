import type { Appointment } from '@ficha/shared';
import { dayNumber, isSameMonth } from '@/lib/agendaDates';
import { APPOINTMENT_STATUS_CLASS } from '@/lib/labels';
import { cn } from '@/lib/utils';

const CABECERAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Cuántos turnos entran en una celda antes de resumir con "+N más". Con más
// que esto la celda crece y la grilla deja de ser un mes de un vistazo.
const VISIBLES_POR_DIA = 3;

/**
 * La vista de planificación: el mes completo para ver dónde hay lugar.
 *
 * Complementa a la semanal, que es la de trabajo. Las dos leen exactamente los
 * mismos datos — antes eran dos pantallas con dos mocks distintos.
 */
export default function MonthView({
  grid,
  year,
  month,
  appointments,
  today,
  selected,
  onSelectDay,
}: {
  grid: string[];
  year: number;
  month: number;
  appointments: Appointment[];
  today: string;
  selected: string;
  onSelectDay: (date: string) => void;
}) {
  // Los cancelados también se muestran, tachados. Esconderlos hacía que un
  // turno "desapareciera" del mes sin explicación, y en una agenda eso se lee
  // como que se perdió — peor que una celda un poco más cargada.
  const porDia = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const previos = porDia.get(a.date);
    if (previos) previos.push(a);
    else porDia.set(a.date, [a]);
  }

  return (
    <div className="grid grid-cols-7 border-t border-l border-border">
      {CABECERAS.map((d) => (
        <div
          key={d}
          className="h-10 flex items-center justify-center text-xs font-medium text-muted-foreground border-r border-b border-border bg-muted/30"
        >
          {d}
        </div>
      ))}

      {grid.map((date) => {
        const delMes = isSameMonth(date, year, month);
        const delDia = porDia.get(date) ?? [];
        const esHoy = date === today;
        const elegido = date === selected;

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDay(date)}
            className={cn(
              'h-24 p-1.5 text-left align-top border-r border-b border-border transition-colors',
              !delMes && 'bg-muted/20',
              elegido ? 'ring-2 ring-primary ring-inset bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <span
              className={cn(
                'inline-flex items-center justify-center w-6 h-6 text-sm rounded-full tabular-nums',
                esHoy && 'bg-primary text-primary-foreground font-medium',
                !delMes && 'text-muted-foreground',
              )}
            >
              {dayNumber(date)}
            </span>

            <div className="mt-1 space-y-0.5 overflow-hidden">
              {delDia.slice(0, VISIBLES_POR_DIA).map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    'text-[10px] px-1 py-0.5 rounded truncate border',
                    APPOINTMENT_STATUS_CLASS[a.status],
                    a.status === 'CANCELLED' && 'line-through opacity-70',
                  )}
                >
                  {a.startTime} {a.patientName.split(' ')[0]}
                </div>
              ))}
              {delDia.length > VISIBLES_POR_DIA && (
                <div className="text-[10px] text-muted-foreground px-1">
                  +{delDia.length - VISIBLES_POR_DIA} más
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
