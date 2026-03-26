import { useState } from 'react'
import { Dumbbell, Search, Clock, RotateCcw, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { exercises } from '@/lib/mock-data'
import type { ExerciseCategory, ExerciseDifficulty } from '@/lib/mock-data'

const CATEGORIES: (ExerciseCategory | 'Todos')[] = [
  'Todos', 'Respiracion', 'Elongacion', 'Postural', 'Fortalecimiento',
]

const DIFFICULTY_LABELS: Record<ExerciseDifficulty, string> = {
  easy:   'Fácil',
  medium: 'Intermedio',
  hard:   'Avanzado',
}

const DIFFICULTY_VARIANTS: Record<ExerciseDifficulty, 'outline' | 'secondary' | 'default'> = {
  easy:   'outline',
  medium: 'secondary',
  hard:   'default',
}

export default function EjerciciosPage() {
  const [query,             setQuery]             = useState('')
  const [category,          setCategory]          = useState<ExerciseCategory | 'Todos'>('Todos')
  const [expanded,          setExpanded]          = useState<string | null>(null)
  const [isNewOpen,         setIsNewOpen]         = useState(false)
  const [newName,           setNewName]           = useState('')
  const [newCategory,       setNewCategory]       = useState<string>('')
  const [newDescription,    setNewDescription]    = useState('')
  const [newInstructions,   setNewInstructions]   = useState('')
  const [newDuration,       setNewDuration]       = useState('')
  const [newFrequency,      setNewFrequency]      = useState('')
  const [newDifficulty,     setNewDifficulty]     = useState<string>('')

  const filtered = exercises.filter(ex => {
    const matchQuery = ex.name.toLowerCase().includes(query.toLowerCase()) ||
                       ex.description.toLowerCase().includes(query.toLowerCase())
    const matchCat   = category === 'Todos' || ex.category === category
    return matchQuery && matchCat
  })

  function closeNew() {
    setIsNewOpen(false)
    setNewName('')
    setNewCategory('')
    setNewDescription('')
    setNewInstructions('')
    setNewDuration('')
    setNewFrequency('')
    setNewDifficulty('')
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Biblioteca de ejercicios</h2>
          <p className="text-muted-foreground text-sm mt-1">Ejercicios para asignar a pacientes</p>
        </div>
        <Button onClick={() => setIsNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo ejercicio
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar ejercicios..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <Button
              key={cat}
              variant={category === cat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Exercise list */}
      <div className="grid gap-3">
        {filtered.map(ex => (
          <Card key={ex.id} className="overflow-hidden">
            <div
              className="p-4 cursor-pointer hover:bg-muted/40 transition-colors select-none"
              onClick={() => setExpanded(expanded === ex.id ? null : ex.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Dumbbell className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium">{ex.name}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{ex.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <Badge variant="secondary">{ex.category}</Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {ex.duration}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <RotateCcw className="h-3 w-3" /> {ex.frequency}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={DIFFICULTY_VARIANTS[ex.difficulty]}>
                    {DIFFICULTY_LABELS[ex.difficulty]}
                  </Badge>
                  {expanded === ex.id
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  }
                </div>
              </div>
            </div>

            {expanded === ex.id && (
              <div className="px-4 pb-4 border-t border-border bg-muted/20">
                <div className="pt-3">
                  <h4 className="text-sm font-medium mb-2">Instrucciones:</h4>
                  <ol className="list-decimal list-inside space-y-1">
                    {ex.instructions.map((step, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Dumbbell className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="font-medium">Sin resultados</p>
              <p className="text-sm text-muted-foreground mt-1">Probá con otra búsqueda o categoría</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* New Exercise Dialog */}
      <Dialog open={isNewOpen} onOpenChange={v => !v && closeNew()}>
        <DialogContent className="max-w-2xl sm:max-w-2xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Crear nuevo ejercicio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ex-name">Nombre</Label>
                <Input
                  id="ex-name"
                  placeholder="Nombre del ejercicio"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={newCategory} onValueChange={v => v !== null && setNewCategory(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter(c => c !== 'Todos').map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-desc">Descripción</Label>
              <Textarea
                id="ex-desc"
                placeholder="Breve descripción del ejercicio"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-inst">Instrucciones (una por línea)</Label>
              <Textarea
                id="ex-inst"
                rows={5}
                placeholder={'Paso 1\nPaso 2\nPaso 3'}
                value={newInstructions}
                onChange={e => setNewInstructions(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ex-dur">Duración</Label>
                <Input id="ex-dur" placeholder="5 minutos" value={newDuration} onChange={e => setNewDuration(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ex-freq">Frecuencia</Label>
                <Input id="ex-freq" placeholder="2 veces al día" value={newFrequency} onChange={e => setNewFrequency(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Dificultad</Label>
                <Select value={newDifficulty} onValueChange={v => v !== null && setNewDifficulty(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Fácil</SelectItem>
                    <SelectItem value="medium">Intermedio</SelectItem>
                    <SelectItem value="hard">Avanzado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeNew}>Cancelar</Button>
              <Button onClick={closeNew}>Guardar ejercicio</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
