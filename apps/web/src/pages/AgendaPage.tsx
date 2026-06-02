import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { mockAppointments, getMockPatientById, getMockAppointmentsByDate } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const HOURS = [
  '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
]

type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  scheduled: 'bg-amber-50 border-amber-300 text-amber-800',
  confirmed:  'bg-green-50 border-green-300 text-green-800',
  completed:  'bg-muted border-border text-muted-foreground',
  cancelled:  'bg-red-50 border-red-300 text-red-700',
  no_show:    'bg-red-50 border-red-300 text-red-700',
}

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Programado',
  confirmed:  'Confirmado',
  completed:  'Completado',
  cancelled:  'Cancelado',
  no_show:    'Inasistencia',
}

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

function formatDateRange(dates: Date[]): string {
  const start = dates[0]
  const end = dates[5]
  const startMonth = start.toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' })
  const endMonth   = end.toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' })
  if (startMonth === endMonth) {
    return `${start.getDate()} – ${end.getDate()} de ${startMonth} ${start.getFullYear()}`
  }
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth} ${end.getFullYear()}`
}

export default function AgendaPage() {
  useEffect(() => { document.title = 'Agenda'; }, []);
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))

  const weekDates = getWeekDates(weekStart)
  const todayStr  = toDateStr(new Date())

  function navigate(dir: -1 | 1) {
    setWeekStart(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 7)
      return d
    })
  }

  function goToday() {
    setWeekStart(getMondayOf(new Date()))
  }

  // Appointments for a given date + hour slot
  function getSlotAppointment(date: Date, hour: string) {
    const dateStr = toDateStr(date)
    return mockAppointments.find(
      a => a.date === dateStr && a.startTime === hour && a.status !== 'cancelled'
    )
  }

  // Summary counts for this week
  const weekSummary = (() => {
    const allApts = weekDates.flatMap(d => getMockAppointmentsByDate(toDateStr(d)))
    return {
      total:       allApts.length,
      confirmed:   allApts.filter(a => a.status === 'confirmed').length,
      scheduled:   allApts.filter(a => a.status === 'scheduled').length,
      free:        HOURS.length * 6 - allApts.length,
    }
  })()

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Agenda semanal</h2>
          <p className="text-muted-foreground text-sm mt-1">{formatDateRange(weekDates)}</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          Imprimir
        </Button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-3 no-print">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" className="h-9 px-4" onClick={goToday}>
          Hoy
        </Button>
        <Button variant="outline" size="icon" onClick={() => navigate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Print header (hidden on screen) */}
      <div className="hidden print:block text-center mb-6">
        <h1 className="text-xl font-bold">Agenda Semanal — Ficha RPG</h1>
        <p className="text-muted-foreground">{formatDateRange(weekDates)}</p>
      </div>

      {/* Grid */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 700 }}>
              <thead>
                <tr className="border-b border-border">
                  <th className="w-16 p-2 text-left text-xs font-medium text-muted-foreground border-r border-border bg-muted/30">
                    Hora
                  </th>
                  {weekDates.map((date, i) => {
                    const isToday = toDateStr(date) === todayStr
                    return (
                      <th
                        key={i}
                        className={cn(
                          'p-2 text-center border-r border-border last:border-r-0',
                          isToday ? 'bg-primary/5' : 'bg-muted/30'
                        )}
                      >
                        <p className="text-xs font-medium text-muted-foreground">{DAYS[i]}</p>
                        <p className={cn('text-xl font-semibold', isToday ? 'text-primary' : 'text-foreground')}>
                          {date.getDate()}
                        </p>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {HOURS.map(hour => (
                  <tr key={hour} className="border-b border-border last:border-b-0">
                    <td className="p-2 text-xs text-muted-foreground border-r border-border font-mono bg-muted/10 align-top whitespace-nowrap">
                      {hour}
                    </td>
                    {weekDates.map((date, di) => {
                      const apt = getSlotAppointment(date, hour)
                      const isToday = toDateStr(date) === todayStr
                      return (
                        <td
                          key={di}
                          className={cn(
                            'p-1 border-r border-border last:border-r-0 h-14 align-top',
                            isToday && 'bg-primary/5'
                          )}
                        >
                          {apt && (
                            <div
                              title={STATUS_LABELS[apt.status as AppointmentStatus]}
                              className={cn(
                                'p-1.5 rounded border text-xs h-full',
                                STATUS_COLORS[apt.status as AppointmentStatus]
                              )}
                            >
                              <p className="font-medium truncate leading-tight">
                                {getMockPatientById(apt.patientId)?.fullName ?? 'Paciente'}
                              </p>
                              <p className="text-[10px] opacity-75 leading-tight mt-0.5">
                                {apt.startTime} – {apt.endTime}
                              </p>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs no-print">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-300" />
          <span className="text-muted-foreground">Programado</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-50 border border-green-300" />
          <span className="text-muted-foreground">Confirmado</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-muted border border-border" />
          <span className="text-muted-foreground">Completado</span>
        </div>
      </div>

      {/* Weekly summary */}
      <Card className="no-print">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resumen de la semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-semibold">{weekSummary.total}</p>
              <p className="text-xs text-muted-foreground">Total turnos</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-semibold text-green-700">{weekSummary.confirmed}</p>
              <p className="text-xs text-muted-foreground">Confirmados</p>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <p className="text-2xl font-semibold text-amber-700">{weekSummary.scheduled}</p>
              <p className="text-xs text-muted-foreground">Pendientes</p>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <p className="text-2xl font-semibold">{weekSummary.free}</p>
              <p className="text-xs text-muted-foreground">Espacios libres</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 1cm; }
        }
      `}</style>
    </div>
  )
}
