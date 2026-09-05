import type { Appointment } from '@ficha/shared';
import { dayNumber, hourSlotOf, shortWeekday, weekdayOf } from '@/lib/agendaDates';
import { APPOINTMENT_STATUS_CLASS } from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * La vista de trabajo: grilla de horas por días.
 *
 * Las columnas y las filas salen de la configuración de la clínica
 * (`workdays`, `workdayStart`, `workdayEnd`), no de constantes. Antes esta
 * pantalla dibujaba 08:00–19:00 de lunes a sábado hardcodeado para todos.
 */
export default function WeekView({
  days,
  hours,
  appointments,
  today,
  workdays,
  onSelect,
  onEmptySlot,
}: {
  days: string[];
  hours: string[];
  appointments: Appointment[];
  today: string;
  /** Días de atención de la clínica, para señalar los que no lo son. */
  workdays: number[];
  onSelect: (a: Appointment) => void;
  onEmptySlot: (date: string, time: string) => void;
}) {
  // Los turnos de cada casilla, indexados una sola vez en vez de filtrar el
  // arreglo entero dentro del doble bucle de la grilla.
  const porCasilla = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const clave = `${a.date}T${hourSlotOf(a.startTime)}`;
    const previos = porCasilla.get(clave);
    if (previos) previos.push(a);
    else porCasilla.set(clave, [a]);
  }

  if (hours.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        El horario de atención de la clínica no define ninguna franja. Revisalo en
        Clínica.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 720 }}>
        <thead>
          <tr className="border-b border-border">
            <th className="w-16 p-2 text-left text-xs font-medium text-muted-foreground border-r border-border bg-muted/30">
              Hora
            </th>
            {days.map((d) => {
              const esHoy = d === today;
              // Un día fuera del horario de atención que igual tiene turnos:
              // se dibuja, pero se marca para que se note que no es habitual.
              const fueraDeHorario = !workdays.includes(weekdayOf(d));
              return (
                <th
                  key={d}
                  className={cn(
                    'p-2 text-center border-r border-border last:border-r-0',
                    esHoy ? 'bg-primary/5' : 'bg-muted/30',
                  )}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {shortWeekday(d)}
                    {fueraDeHorario && (
                      <span
                        className="ml-1 text-amber-600"
                        title="La clínica no atiende este día"
                      >
                        •
                      </span>
                    )}
                  </p>
                  <p
                    className={cn(
                      'text-xl font-semibold tabular-nums',
                      esHoy ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    {dayNumber(d)}
                  </p>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {hours.map((hora) => (
            <tr key={hora} className="border-b border-border last:border-b-0">
              <td className="p-2 text-xs text-muted-foreground border-r border-border font-mono bg-muted/10 align-top whitespace-nowrap tabular-nums">
                {hora}
              </td>
              {days.map((d) => {
                const enCasilla = porCasilla.get(`${d}T${hora}`) ?? [];
                const esHoy = d === today;
                return (
                  <td
                    key={d}
                    className={cn(
                      'p-1 border-r border-border last:border-r-0 align-top',
                      esHoy && 'bg-primary/5',
                    )}
                    style={{ height: 56 }}
                  >
                    {enCasilla.length === 0 ? (
                      // La casilla vacía es el botón de agendar: hacer click
                      // en el hueco es cómo se usa una agenda.
                      <button
                        type="button"
                        onClick={() => onEmptySlot(d, hora)}
                        aria-label={`Agendar el ${d} a las ${hora}`}
                        className="w-full h-full min-h-12 rounded transition-colors hover:bg-primary/10 no-print"
                      />
                    ) : (
                      <div className="space-y-1">
                        {enCasilla.map((a) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => onSelect(a)}
                            title={`${a.startTime}–${a.endTime} · ${a.patientName}`}
                            className={cn(
                              'w-full text-left p-1.5 rounded border text-xs transition-opacity hover:opacity-80',
                              APPOINTMENT_STATUS_CLASS[a.status],
                              a.status === 'CANCELLED' && 'line-through opacity-70',
                            )}
                          >
                            <p className="font-medium truncate leading-tight">
                              {a.patientName}
                            </p>
                            <p className="text-[10px] opacity-75 leading-tight mt-0.5 tabular-nums">
                              {a.startTime} – {a.endTime}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
