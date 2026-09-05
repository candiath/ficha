import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Printer } from 'lucide-react';
import type { Appointment } from '@ficha/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AppointmentDetailDialog from '@/components/agenda/AppointmentDetailDialog';
import AppointmentDialog from '@/components/agenda/AppointmentDialog';
import MonthView from '@/components/agenda/MonthView';
import WeekView from '@/components/agenda/WeekView';
import {
  addDays,
  daysFrom,
  formatLongDate,
  formatMonth,
  formatRange,
  hourSlots,
  mondayOf,
  monthGrid,
  todayInClinic,
  weekdayOf,
} from '@/lib/agendaDates';
import { APPOINTMENT_STATUS_CLASS, APPOINTMENT_STATUS_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { appointmentApi, appointmentKeys } from '@/services/appointments';
import { tenantApi, tenantKeys } from '@/services/tenant';

type Vista = 'semana' | 'mes';

/**
 * La agenda: una sola pantalla con dos vistas de los mismos datos.
 *
 * Antes eran dos rutas —Agenda y Turnos— con dos mocks distintos entre sí, las
 * mismas etiquetas escritas dos veces con nombres diferentes, y la de Turnos
 * congelada en marzo de 2026.
 *
 * Todas las fechas que se manejan acá son strings "YYYY-MM-DD" en hora de la
 * clínica, tal como los devuelve la API. El navegador no vuelve a convertir
 * nada: es lo que evita que un turno de las 22:00 se dibuje al día siguiente.
 */
export default function AgendaPage() {
  useEffect(() => { document.title = 'Agenda'; }, []);

  const [vista, setVista] = useState<Vista>('semana');
  // Se guarda la fecha en foco y no un offset, para que cambiar de vista no
  // pierda dónde estabas. null = hoy, resuelto cuando llega la configuración.
  const [ancla, setAncla] = useState<string | null>(null);
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<Appointment | null>(null);
  const [nuevo, setNuevo] = useState<{ date: string; time: string } | null>(null);

  const { data: tenant } = useQuery({
    queryKey: tenantKeys.config,
    queryFn: tenantApi.get,
  });

  // Hasta que llegue la configuración no se sabe ni qué día es hoy para la
  // clínica. Se usa la zona del navegador solo para no renderizar en blanco;
  // la query de turnos espera a `tenant` y no se dispara con datos provisorios.
  const hoy = todayInClinic(tenant?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const foco = ancla ?? hoy;
  const dia = diaElegido ?? hoy;

  const lunes = mondayOf(foco);
  const anio = Number(foco.slice(0, 4));
  const mes = Number(foco.slice(5, 7)) - 1;
  const grillaMes = monthGrid(anio, mes);

  // El rango que se le pide a la API depende de la vista. La grilla del mes
  // son 42 días fijos, así que incluye el relleno de los meses vecinos y sus
  // turnos también se ven.
  const [desde, hasta] =
    vista === 'semana' ? [lunes, addDays(lunes, 6)] : [grillaMes[0], grillaMes[41]];

  const { data: turnos = [], isError } = useQuery({
    queryKey: appointmentKeys.range(desde, hasta),
    queryFn: () => appointmentApi.list(desde, hasta),
    enabled: !!tenant,
  });

  if (!tenant) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-semibold tracking-tight">Agenda</h2>
        <p className="text-sm text-muted-foreground mt-2">Cargando...</p>
      </div>
    );
  }

  // Los días en que la clínica atiende, MÁS cualquier otro que tenga turnos.
  //
  // Ese "más" es el punto: la configuración da la forma del lienzo vacío, no
  // decide qué datos existen. Filtrando solo por workdays, un turno cargado un
  // sábado en una clínica de lunes a viernes no tiene columna donde dibujarse
  // y desaparece sin ninguna señal — que es exactamente lo que pasó.
  const conTurnos = new Set(turnos.map((a) => a.date));
  const diasSemana = daysFrom(lunes, 7).filter(
    (d) => tenant.workdays.includes(weekdayOf(d)) || conTurnos.has(d),
  );

  // Mismo criterio para las horas: el rango de atención se estira si hay un
  // turno antes de abrir o después de cerrar.
  const horas = hourSlots(
    tenant.workdayStart,
    tenant.workdayEnd,
    turnos.filter((a) => diasSemana.includes(a.date)).map((a) => a.startTime),
  );

  const delDia = turnos
    .filter((a) => a.date === dia)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  function navegar(direccion: -1 | 1) {
    if (vista === 'semana') {
      setAncla(addDays(foco, direccion * 7));
      return;
    }
    // Al 1° del mes vecino, y no "30 días después": los meses no miden igual.
    setAncla(new Date(Date.UTC(anio, mes + direccion, 1)).toISOString().slice(0, 10));
  }

  const titulo =
    vista === 'semana' ? formatRange(lunes, addDays(lunes, 6)) : formatMonth(anio, mes);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Agenda</h2>
          <p className="text-muted-foreground text-sm mt-1">{titulo}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-input overflow-hidden">
            {(['semana', 'mes'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                className={cn(
                  'px-3 h-8 text-sm capitalize transition-colors',
                  vista === v
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Button>
          <Button onClick={() => setNuevo({ date: dia, time: tenant.workdayStart })}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo turno
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 no-print">
        <Button variant="outline" size="icon" onClick={() => navegar(-1)} aria-label="Anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className="h-9 px-4"
          onClick={() => {
            setAncla(hoy);
            setDiaElegido(hoy);
          }}
        >
          Hoy
        </Button>
        <Button variant="outline" size="icon" onClick={() => navegar(1)} aria-label="Siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Encabezado que solo sale al imprimir: la hoja tiene que decir de qué
          clínica y de qué semana es. */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-xl font-bold">Agenda — {tenant.name}</h1>
        <p className="text-muted-foreground">{titulo}</p>
      </div>

      {isError && (
        <p className="text-destructive text-sm">No se pudieron cargar los turnos.</p>
      )}

      {vista === 'semana' ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <WeekView
              days={diasSemana}
              hours={horas}
              appointments={turnos}
              today={hoy}
              workdays={tenant.workdays}
              onSelect={setSeleccionado}
              onEmptySlot={(date, time) => setNuevo({ date, time })}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 overflow-hidden">
            <CardContent className="p-0">
              <MonthView
                grid={grillaMes}
                year={anio}
                month={mes}
                appointments={turnos}
                today={hoy}
                selected={dia}
                onSelectDay={setDiaElegido}
              />
            </CardContent>
          </Card>

          <Card className="no-print">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">{formatLongDate(dia)}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {delDia.length} turno{delDia.length === 1 ? '' : 's'}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {delDia.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay turnos este día
                </p>
              ) : (
                delDia.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSeleccionado(a)}
                    className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {a.startTime} – {a.endTime}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap',
                          APPOINTMENT_STATUS_CLASS[a.status],
                        )}
                      >
                        {APPOINTMENT_STATUS_LABELS[a.status]}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{a.patientName}</p>
                    {a.episodeMainComplaint && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {a.episodeMainComplaint}
                      </p>
                    )}
                  </button>
                ))
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setNuevo({ date: dia, time: tenant.workdayStart })}
              >
                <Plus className="h-4 w-4 mr-2" />
                Agendar este día
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <AppointmentDetailDialog
        appointment={seleccionado}
        onClose={() => setSeleccionado(null)}
      />

      {nuevo && (
        <AppointmentDialog
          open
          onClose={() => setNuevo(null)}
          date={nuevo.date}
          time={nuevo.time}
          sameDay={turnos.filter((a) => a.date === nuevo.date)}
        />
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 1cm; }
        }
      `}</style>
    </div>
  );
}
