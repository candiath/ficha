import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { Users, CalendarDays, TrendingUp, CreditCard, Search, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dashboardApi, dashboardKeys } from '@/services/dashboard'
import { patientApi, patientKeys } from '@/services/patients'
import { cn } from '@/lib/utils'

// Cinco colores porque la API devuelve el top 5 de motivos de consulta:
// con menos, dos porciones del donut compartirían color.
const PATHOLOGY_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

// La API devuelve los meses como "YYYY-MM" (agnóstica de locale) y el label
// corto lo arma el cliente. El día 1 a mediodía UTC evita que el corrimiento
// de zona muestre el mes anterior.
function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1, 1, 12)).toLocaleDateString('es-AR', {
    month: 'short',
    timeZone: 'UTC',
  })
}

export default function DashboardPage() {
  useEffect(() => { document.title = 'Dashboard'; }, []);
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: dashboardApi.getStats,
  })

  // El buscador filtra en el cliente: el listado completo de pacientes ya
  // está cacheado por la página de Pacientes, así que tipear no pega a la API.
  const { data: patients = [] } = useQuery({
    queryKey: patientKeys.all,
    queryFn: patientApi.list,
  })

  const searchResults = query.length > 0
    ? patients.filter(p =>
        p.fullName.toLowerCase().includes(query.toLowerCase())
      )
    : []

  const statCards = [
    {
      label: 'Pacientes activos',
      value: stats?.activePatients,
      icon: Users,
      color: 'text-chart-1',
      bg: 'bg-chart-1/10',
    },
    {
      label: 'Sesiones totales',
      value: stats?.totalSessions,
      icon: CalendarDays,
      color: 'text-chart-2',
      bg: 'bg-chart-2/10',
    },
    {
      label: 'Sesiones este mes',
      value: stats?.sessionsThisMonth,
      icon: TrendingUp,
      color: 'text-chart-3',
      bg: 'bg-chart-3/10',
    },
    {
      label: 'Cobros pendientes',
      value: stats?.pendingPayments,
      icon: CreditCard,
      color: 'text-chart-4',
      bg: 'bg-chart-4/10',
    },
  ]

  const sessionsByMonth = (stats?.sessionsByMonth ?? []).map(m => ({
    ...m,
    label: formatMonthLabel(m.month),
  }))
  const pathologies = stats?.pathologies ?? []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Bienvenido de vuelta a tu práctica
          </p>
        </div>
        <Link to="/patients">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo paciente
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar paciente por nombre..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => query && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          className="pl-10 h-10"
        />
        {showResults && searchResults.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            {searchResults.map((p) => (
              <Link
                key={p.id}
                to={`/patients/${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                  {p.fullName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{p.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.occupation}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
        {showResults && query && searchResults.length === 0 && (
          <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground text-center">
            Sin resultados
          </div>
        )}
      </div>

      {isError && (
        <p className="text-destructive text-sm">
          Error al cargar las estadísticas. ¿Está corriendo la API?
        </p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    s.bg,
                  )}
                >
                  <s.icon className={cn("h-5 w-5", s.color)} />
                </div>
                <div>
                  <p className="text-2xl font-semibold">
                    {s.value ?? (isLoading ? '—' : 0)}
                  </p>
                  <p className="text-xs text-muted-foreground leading-tight">
                    {s.label}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Sessions by month */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sesiones por mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sessionsByMonth}
                  margin={{ top: 4, right: 4, bottom: 4, left: -20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="label"
                    fontSize={12}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    fontSize={12}
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  <Bar
                    dataKey="count"
                    name="Sesiones"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pathologies donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Patologías más frecuentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pathologies.length === 0 ? (
              // Sin episodios con motivo de consulta cargado el donut queda
              // vacío y sin leyenda: mejor decir por qué no hay nada.
              <div className="h-56 flex items-center justify-center">
                <p className="text-sm text-muted-foreground text-center">
                  {isLoading
                    ? 'Cargando...'
                    : 'Sin datos suficientes. Cargá el motivo de consulta en los episodios.'}
                </p>
              </div>
            ) : (
              <>
                <div className="h-56 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pathologies}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={80}
                        dataKey="count"
                        nameKey="name"
                        paddingAngle={3}
                      >
                        {pathologies.map((p, i) => (
                          <Cell
                            key={p.name}
                            fill={PATHOLOGY_COLORS[i % PATHOLOGY_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend: lleva la identidad de cada porción. El motivo de
                    consulta es texto libre y puede ser un párrafo entero, así
                    que se trunca y el nombre completo queda en el title. */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {pathologies.map((p, i) => (
                    <div
                      key={p.name}
                      title={p.name}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground max-w-full"
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            PATHOLOGY_COLORS[i % PATHOLOGY_COLORS.length],
                        }}
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0">({p.count})</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
