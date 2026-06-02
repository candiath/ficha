import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  User,
  Check,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Mock data ────────────────────────────────────────────────────────────────

type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

interface MockPatient {
  id: string
  fullName: string
}

interface MockAppointment {
  id: string
  patientId: string
  date: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  notes?: string
}

const MOCK_PATIENTS: MockPatient[] = [
  { id: 'p1', fullName: 'María García' },
  { id: 'p2', fullName: 'Carlos López' },
  { id: 'p3', fullName: 'Ana Martínez' },
  { id: 'p4', fullName: 'Jorge Pérez' },
  { id: 'p5', fullName: 'Lucía Fernández' },
]

const MOCK_APPOINTMENTS: MockAppointment[] = [
  { id: 'a1',  patientId: 'p1', date: '2026-03-23', startTime: '09:00', endTime: '10:00', status: 'confirmed' },
  { id: 'a2',  patientId: 'p2', date: '2026-03-23', startTime: '10:30', endTime: '11:30', status: 'scheduled', notes: 'Primera consulta' },
  { id: 'a3',  patientId: 'p3', date: '2026-03-23', startTime: '12:00', endTime: '13:00', status: 'confirmed' },
  { id: 'a4',  patientId: 'p4', date: '2026-03-24', startTime: '09:00', endTime: '10:00', status: 'scheduled' },
  { id: 'a5',  patientId: 'p5', date: '2026-03-24', startTime: '11:00', endTime: '12:00', status: 'confirmed' },
  { id: 'a6',  patientId: 'p1', date: '2026-03-25', startTime: '10:00', endTime: '11:00', status: 'scheduled' },
  { id: 'a7',  patientId: 'p2', date: '2026-03-26', startTime: '09:30', endTime: '10:30', status: 'confirmed' },
  { id: 'a8',  patientId: 'p3', date: '2026-03-27', startTime: '14:00', endTime: '15:00', status: 'scheduled' },
  { id: 'a9',  patientId: 'p4', date: '2026-03-10', startTime: '09:00', endTime: '10:00', status: 'completed' },
  { id: 'a10', patientId: 'p5', date: '2026-03-10', startTime: '11:00', endTime: '12:00', status: 'completed' },
  { id: 'a11', patientId: 'p1', date: '2026-03-12', startTime: '10:00', endTime: '11:00', status: 'no_show' },
  { id: 'a12', patientId: 'p2', date: '2026-03-15', startTime: '09:00', endTime: '10:00', status: 'cancelled' },
  { id: 'a13', patientId: 'p3', date: '2026-03-18', startTime: '14:00', endTime: '15:00', status: 'completed' },
  { id: 'a14', patientId: 'p4', date: '2026-03-28', startTime: '10:00', endTime: '11:00', status: 'scheduled' },
  { id: 'a15', patientId: 'p5', date: '2026-03-29', startTime: '09:00', endTime: '10:00', status: 'confirmed' },
]

function getPatient(id: string) {
  return MOCK_PATIENTS.find((p) => p.id === id)
}

function getAppointmentsByDate(date: string) {
  return MOCK_APPOINTMENTS.filter((a) => a.date === date)
}

function getUpcomingAppointments(fromDate: string, days: number) {
  const from = new Date(fromDate + 'T00:00:00')
  const to = new Date(from)
  to.setDate(to.getDate() + days)
  return MOCK_APPOINTMENTS.filter((a) => {
    const d = new Date(a.date + 'T00:00:00')
    return d >= from && d <= to && a.status !== 'cancelled'
  }).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; className: string }> = {
  scheduled: { label: 'Programado',  className: 'bg-muted text-muted-foreground' },
  confirmed: { label: 'Confirmado',  className: 'bg-blue-500/10 text-blue-600' },
  completed: { label: 'Completado',  className: 'bg-primary/10 text-primary' },
  cancelled: { label: 'Cancelado',   className: 'bg-destructive/10 text-destructive' },
  no_show:   { label: 'No asistió',  className: 'bg-amber-500/10 text-amber-600' },
}

const DAYS   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const TODAY = '2026-03-25'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TurnosPage() {
  useEffect(() => { document.title = 'Turnos'; }, []);
  const [currentDate, setCurrentDate]         = useState(new Date(2026, 2, 1))
  const [selectedDate, setSelectedDate]       = useState(TODAY)
  const [showNewAppointment, setShowNewAppointment] = useState(false)

  const year  = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const total = daysInMonth(year, month)
  const first = firstDayOfMonth(year, month)

  const formatKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  const selectedAppointments = getAppointmentsByDate(selectedDate)
  const upcoming             = getUpcomingAppointments(TODAY, 7)

  // Build calendar cells
  const cells: React.ReactNode[] = []

  for (let i = 0; i < first; i++) {
    cells.push(<div key={`empty-${i}`} className="h-24 bg-muted/20 border-r border-b border-border" />)
  }

  for (let day = 1; day <= total; day++) {
    const key         = formatKey(day)
    const dayApts     = MOCK_APPOINTMENTS.filter((a) => a.date === key && a.status !== 'cancelled')
    const isSelected  = key === selectedDate
    const isToday     = key === TODAY

    cells.push(
      <button
        key={day}
        onClick={() => setSelectedDate(key)}
        className={cn(
          'h-24 p-2 text-left transition-colors border-r border-b border-border w-full',
          isSelected ? 'bg-primary/5 ring-2 ring-primary ring-inset' : 'hover:bg-muted/50',
          isToday && !isSelected && 'bg-accent/60',
        )}
      >
        <span className={cn(
          'inline-flex items-center justify-center w-6 h-6 text-sm rounded-full',
          isToday && 'bg-primary text-primary-foreground font-medium',
        )}>
          {day}
        </span>
        <div className="mt-1 space-y-0.5 overflow-hidden">
          {dayApts.slice(0, 2).map((apt) => {
            const patient = getPatient(apt.patientId)
            return (
              <div
                key={apt.id}
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded truncate',
                  apt.status === 'confirmed'
                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {apt.startTime} {patient?.fullName.split(' ')[0]}
              </div>
            )
          })}
          {dayApts.length > 2 && (
            <div className="text-xs text-muted-foreground px-1.5">
              +{dayApts.length - 2} más
            </div>
          )}
        </div>
      </button>,
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Turnos</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestioná las citas de tus pacientes</p>
        </div>
        <Button onClick={() => setShowNewAppointment(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo turno
        </Button>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Calendar */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-lg font-medium w-44 text-center">
                {MONTHS[month]} {year}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCurrentDate(new Date(2026, 2, 1))
                setSelectedDate(TODAY)
              }}
            >
              Hoy
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-t border-l border-border">
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="h-10 flex items-center justify-center text-xs font-medium text-muted-foreground border-r border-b border-border bg-muted/30"
                >
                  {d}
                </div>
              ))}
              {cells}
            </div>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">

          {/* Selected day */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium capitalize">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('es-AR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {selectedAppointments.length} turno{selectedAppointments.length !== 1 ? 's' : ''}
              </p>
            </CardHeader>
            <CardContent>
              {selectedAppointments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay turnos para este día
                </p>
              ) : (
                <div className="space-y-3">
                  {selectedAppointments.map((apt) => {
                    const patient = getPatient(apt.patientId)
                    const status  = STATUS_CONFIG[apt.status]
                    return (
                      <div
                        key={apt.id}
                        className="p-3 rounded-lg border border-border hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            {apt.startTime} – {apt.endTime}
                          </div>
                          <span className={cn('text-xs px-2 py-0.5 rounded-full whitespace-nowrap', status.className)}>
                            {status.label}
                          </span>
                        </div>
                        <Link
                          to={`/patients/${apt.patientId}`}
                          className="flex items-center gap-2 mt-2 text-sm hover:text-primary transition-colors"
                        >
                          <User className="h-4 w-4 shrink-0" />
                          {patient?.fullName}
                        </Link>
                        {apt.notes && (
                          <p className="text-xs text-muted-foreground mt-2">{apt.notes}</p>
                        )}
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" className="flex-1 h-8 text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Próximos 7 días</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Sin turnos próximos</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.slice(0, 6).map((apt) => {
                    const patient = getPatient(apt.patientId)
                    return (
                      <div key={apt.id} className="flex items-center gap-3 text-sm">
                        <div className="w-14 text-muted-foreground shrink-0">
                          {new Date(apt.date + 'T00:00:00').toLocaleDateString('es-AR', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </div>
                        <div className="w-12 text-muted-foreground shrink-0">{apt.startTime}</div>
                        <div className="flex-1 truncate font-medium">
                          {patient?.fullName.split(' ').slice(0, 2).join(' ')}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* New appointment modal */}
      {showNewAppointment && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle>Nuevo turno</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Paciente</label>
                <select className="w-full mt-1.5 h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Seleccionar paciente...</option>
                  {MOCK_PATIENTS.map((p) => (
                    <option key={p.id} value={p.id}>{p.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Fecha</label>
                  <Input type="date" className="mt-1.5" defaultValue={selectedDate} />
                </div>
                <div>
                  <label className="text-sm font-medium">Hora</label>
                  <Input type="time" className="mt-1.5" defaultValue="09:00" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Duración</label>
                <select className="w-full mt-1.5 h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60" selected>60 minutos</option>
                  <option value="90">90 minutos</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Notas <span className="text-muted-foreground font-normal">(opcional)</span></label>
                <Input className="mt-1.5" placeholder="Ej: Primera consulta, traer estudios..." />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowNewAppointment(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={() => setShowNewAppointment(false)}>
                  Guardar turno
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  )
}
