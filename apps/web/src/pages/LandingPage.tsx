import {
  ActivitySquare,
  BarChart3,
  CalendarDays,
  Camera,
  ChevronRight,
  CreditCard,
  FileText,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

// Marca del build del front. Se contrasta con la que expone GET /health
// de la API: los dos deploys son independientes (Netlify el front, Render
// la API), así que pueden quedar parados en commits distintos sin aviso.
const BUILD_MARKER = 'canary-2026-08-15';

const FEATURES = [
  {
    icon: Users,
    title: 'Gestión de pacientes',
    description:
      'Registrá y administrá la ficha completa de cada paciente: datos personales, médico derivante, ocupación y más.',
  },
  {
    icon: FileText,
    title: 'Evaluación inicial',
    description:
      'Documentá la primera consulta con anamnesis completa y adjuntá fotos posturales para tener un punto de partida claro.',
  },
  {
    icon: Camera,
    title: 'Fotos de evolución',
    description:
      'Comparé la postura del paciente entre la evaluación inicial y las sesiones actuales. Un diferenciador clave en RPG.',
  },
  {
    icon: CalendarDays,
    title: 'Seguimiento de sesiones',
    description:
      'Registrá cada sesión con las técnicas RPG utilizadas, la región corporal trabajada y las notas clínicas relevantes.',
  },
  {
    icon: ActivitySquare,
    title: 'Historial clínico',
    description:
      'Accedé a la línea de tiempo completa de cada paciente: sesiones, evaluaciones y evolución en un solo lugar.',
  },
  {
    icon: BarChart3,
    title: 'Estadísticas',
    description:
      'Visualizá pacientes activos, sesiones del mes y evolución de tu práctica para tomar mejores decisiones.',
  },
  {
    icon: CreditCard,
    title: 'Gestión de pagos',
    description:
      'Registrá cobros, controlá deudas y llevá el seguimiento financiero de tu consultorio. Próximamente.',
    soon: true,
  },
  {
    icon: Users,
    title: 'Multi-profesional',
    description:
      'Preparado para consultorios con varios kinesiólogos. Cada profesional gestiona sus propios pacientes de forma independiente. Próximamente.',
    soon: true,
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Registrás al paciente',
    description: 'Cargás sus datos personales, médico derivante y motivo de consulta en minutos.',
  },
  {
    n: '02',
    title: 'Realizás la evaluación inicial',
    description: 'Documentás la postura, adjuntás fotos y dejás registrado el punto de partida.',
  },
  {
    n: '03',
    title: 'Registrás cada sesión',
    description: 'Anotás las técnicas y regiones trabajadas. El historial se construye solo.',
  },
]

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-semibold text-lg tracking-tight">Ficha RPG</span>
          <Button size="sm" onClick={() => navigate('/dashboard')}>
            Abrir app
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 py-24 text-center">
        <Badge variant="secondary" className="mb-6">
          Para kinesiólogos especializados en RPG
        </Badge>
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-tight">
          La ficha clínica digital
          <br />
          que tu consultorio necesita
        </h1>
        <p className="text-muted-foreground text-xl max-w-2xl mx-auto mb-10">
          Administrá pacientes, evaluaciones posturales, sesiones y evolución fotográfica
          desde una sola herramienta, diseñada para la práctica de RPG.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button size="lg" onClick={() => navigate('/dashboard')}>
            Empezar ahora
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button variant="outline" size="lg" onClick={() => document.querySelector('#features')?.scrollIntoView({ behavior: 'smooth' })}>Ver funcionalidades</Button>
        </div>
      </section>

      <Separator />

      {/* Features */}
      <section id="features" className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Todo lo que necesitás</h2>
          <p className="text-muted-foreground text-lg">
            Herramientas pensadas para el flujo real de un consultorio RPG.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, description, soon }) => (
            <Card key={title} className={soon ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-md bg-secondary w-fit">
                    <Icon className="h-5 w-5 text-secondary-foreground" />
                  </div>
                  {soon && (
                    <Badge variant="outline" className="text-xs">
                      Próximamente
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base mt-3">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator />

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">¿Cómo funciona?</h2>
          <p className="text-muted-foreground text-lg">Tres pasos para tener todo organizado.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map(({ n, title, description }) => (
            <div key={n} className="flex flex-col items-center text-center gap-3">
              <span className="text-4xl font-bold text-muted-foreground/30 leading-none">{n}</span>
              <h3 className="font-semibold text-base">{title}</h3>
              <p className="text-muted-foreground text-sm">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Pricing placeholder */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Planes</h2>
          <p className="text-muted-foreground text-lg">Simple y transparente.</p>
        </div>
        <div className="flex justify-center">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <Badge variant="secondary" className="w-fit mx-auto mb-2">
                Plan Pro
              </Badge>
              <CardTitle className="text-4xl font-bold">
                $XX
                <span className="text-base font-normal text-muted-foreground"> / mes</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                'Pacientes ilimitados',
                'Evaluaciones y sesiones ilimitadas',
                'Fotos de evolución',
                'Historial clínico completo',
                'Estadísticas del consultorio',
                'Gestión de pagos (próximamente)',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm">
                  <ChevronRight className="h-4 w-4 text-primary shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
              <div className="pt-4">
                <Button className="w-full" onClick={() => navigate('/patients')}>Empezar ahora</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t bg-secondary">
        <div className="max-w-5xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Organizá tu consultorio hoy
          </h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
            Dejá de usar planillas y papel. Toda la información de tus pacientes, siempre ordenada y accesible.
          </p>
          <Button size="lg" onClick={() => navigate('/patients')}>
            Abrir la app
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between text-sm text-muted-foreground">
          <span>Ficha RPG</span>
          <span className="text-xs opacity-60">build {BUILD_MARKER}</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  )
}
