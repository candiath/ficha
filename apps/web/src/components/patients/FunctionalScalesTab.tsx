import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { functionalScaleApi, functionalScaleKeys } from '@/services/functionalScales';
import type { ScaleType } from '@/types/functionalScale';

// ── Question definitions ──────────────────────────────────────────────────────

interface ScaleQuestion {
  key: string;
  label: string;
  options: string[];
}

const OSWESTRY_QUESTIONS: ScaleQuestion[] = [
  {
    key: 'q1',
    label: '1. Intensidad del dolor',
    options: [
      '0 — Puedo tolerar el dolor sin necesitar analgésicos',
      '1 — El dolor es intenso pero puedo manejarlo sin analgésicos',
      '2 — Los analgésicos me alivian completamente el dolor',
      '3 — Los analgésicos me alivian moderadamente el dolor',
      '4 — Los analgésicos me alivian muy poco el dolor',
      '5 — Los analgésicos no afectan el dolor y no los uso',
    ],
  },
  {
    key: 'q2',
    label: '2. Cuidado personal (lavarse, vestirse, etc.)',
    options: [
      '0 — Puedo cuidarme normalmente sin causar dolor extra',
      '1 — Puedo cuidarme normalmente pero me causa dolor extra',
      '2 — Es doloroso cuidarme a mí mismo y soy lento y cuidadoso',
      '3 — Necesito algo de ayuda pero me las arreglo con la mayoría de cuidados personales',
      '4 — Necesito ayuda diaria en la mayoría de los aspectos del cuidado personal',
      '5 — No me visto, me lavo con dificultad y me quedo en la cama',
    ],
  },
  {
    key: 'q3',
    label: '3. Levantar peso',
    options: [
      '0 — Puedo levantar objetos pesados sin dolor extra',
      '1 — Puedo levantar objetos pesados pero provoca dolor extra',
      '2 — El dolor no me permite levantar objetos pesados del suelo, pero puedo si están bien ubicados',
      '3 — El dolor no me permite levantar objetos pesados, pero sí medianos si están bien ubicados',
      '4 — Solo puedo levantar objetos muy livianos',
      '5 — No puedo levantar ni cargar nada',
    ],
  },
  {
    key: 'q4',
    label: '4. Caminar',
    options: [
      '0 — El dolor no me impide caminar cualquier distancia',
      '1 — El dolor me impide caminar más de 1 km',
      '2 — El dolor me impide caminar más de 500 m',
      '3 — El dolor me impide caminar más de 200 m',
      '4 — Solo puedo caminar con bastón o muleta',
      '5 — Estoy en cama la mayor parte del tiempo y debo arrastrarme al baño',
    ],
  },
  {
    key: 'q5',
    label: '5. Estar sentado',
    options: [
      '0 — Puedo sentarme en cualquier silla todo el tiempo que quiera',
      '1 — Solo puedo sentarme en mi silla favorita tanto tiempo como quiera',
      '2 — El dolor me impide estar sentado más de 1 hora',
      '3 — El dolor me impide estar sentado más de 1/2 hora',
      '4 — El dolor me impide estar sentado más de 10 minutos',
      '5 — El dolor me impide sentarme del todo',
    ],
  },
  {
    key: 'q6',
    label: '6. Estar de pie',
    options: [
      '0 — Puedo estar de pie tanto tiempo como quiera sin dolor extra',
      '1 — Puedo estar de pie tanto tiempo como quiera pero me causa dolor extra',
      '2 — El dolor me impide estar de pie más de 1 hora',
      '3 — El dolor me impide estar de pie más de 1/2 hora',
      '4 — El dolor me impide estar de pie más de 10 minutos',
      '5 — El dolor me impide estar de pie del todo',
    ],
  },
  {
    key: 'q7',
    label: '7. Dormir',
    options: [
      '0 — Mi sueño nunca se ve perturbado por el dolor',
      '1 — Mi sueño se ve perturbado por el dolor de vez en cuando',
      '2 — Debido al dolor duermo menos de 6 horas',
      '3 — Debido al dolor duermo menos de 4 horas',
      '4 — Debido al dolor duermo menos de 2 horas',
      '5 — El dolor me impide dormir del todo',
    ],
  },
  {
    key: 'q8',
    label: '8. Vida sexual',
    options: [
      '0 — Mi vida sexual es normal, sin dolor extra',
      '1 — Mi vida sexual es normal pero causa algo de dolor extra',
      '2 — Mi vida sexual es casi normal pero causa mucho dolor extra',
      '3 — Mi vida sexual está muy limitada por el dolor',
      '4 — Mi vida sexual es prácticamente inexistente a causa del dolor',
      '5 — El dolor me impide tener vida sexual',
    ],
  },
  {
    key: 'q9',
    label: '9. Vida social',
    options: [
      '0 — Mi vida social es normal, sin dolor extra',
      '1 — Mi vida social es normal, pero aumenta mi dolor',
      '2 — El dolor no me impide participar en actividades sociales más activas (deportes, etc.)',
      '3 — El dolor limita mi vida social y no salgo tan a menudo',
      '4 — El dolor limita mi vida social a mi hogar',
      '5 — El dolor no me permite llevar vida social a causa del dolor',
    ],
  },
  {
    key: 'q10',
    label: '10. Viajes',
    options: [
      '0 — Puedo viajar a cualquier parte sin dolor extra',
      '1 — Puedo viajar a cualquier parte, pero con dolor extra',
      '2 — El dolor es intenso pero puedo realizar viajes de más de 2 horas',
      '3 — El dolor me limita los viajes a menos de 1 hora',
      '4 — El dolor me limita a viajes cortos, de menos de 30 min.',
      '5 — El dolor me impide viajar excepto a médicos o al hospital',
    ],
  },
];

const NDI_QUESTIONS: ScaleQuestion[] = [
  {
    key: 'q1',
    label: '1. Intensidad del dolor',
    options: [
      '0 — No tengo dolor en este momento',
      '1 — El dolor es muy leve en este momento',
      '2 — El dolor es moderado en este momento',
      '3 — El dolor es bastante intenso en este momento',
      '4 — El dolor es muy intenso en este momento',
      '5 — El dolor es el peor imaginable en este momento',
    ],
  },
  {
    key: 'q2',
    label: '2. Cuidado personal',
    options: [
      '0 — Puedo cuidarme sin causar dolor mayor',
      '1 — Puedo cuidarme normalmente, pero me causa dolor mayor',
      '2 — Duele cuidarme y soy lento y meticuloso',
      '3 — Necesito ayuda pero me las arreglo con la mayor parte',
      '4 — Necesito ayuda en la mayoría de los cuidados personales',
      '5 — No me visto, me lavo con dificultad y me quedo en cama',
    ],
  },
  {
    key: 'q3',
    label: '3. Levantar peso',
    options: [
      '0 — Puedo levantar objetos pesados sin dolor mayor',
      '1 — Puedo levantar objetos pesados pero causa dolor mayor',
      '2 — El dolor me impide levantar objetos pesados del suelo pero puedo si están ubicados a buena altura',
      '3 — El dolor me impide levantar cosas pesadas, pero puedo levantar o cargar cosas livianas a medianas',
      '4 — Solo puedo levantar objetos muy livianos',
      '5 — No puedo levantar ni cargar nada',
    ],
  },
  {
    key: 'q4',
    label: '4. Lectura',
    options: [
      '0 — Puedo leer tanto como quiera sin dolor de cuello',
      '1 — Puedo leer tanto como quiera con leve dolor de cuello',
      '2 — Puedo leer tanto como quiera con dolor moderado de cuello',
      '3 — No puedo leer tanto como quiero por dolor moderado de cuello',
      '4 — Apenas puedo leer por intenso dolor de cuello',
      '5 — No puedo leer en absoluto',
    ],
  },
  {
    key: 'q5',
    label: '5. Cefalea (dolor de cabeza)',
    options: [
      '0 — No tengo dolor de cabeza en absoluto',
      '1 — Tengo dolores de cabeza leves que no aparecen con frecuencia',
      '2 — Tengo dolores de cabeza moderados que no aparecen con frecuencia',
      '3 — Tengo dolores de cabeza moderados que aparecen con frecuencia',
      '4 — Tengo dolores de cabeza intensos que aparecen con frecuencia',
      '5 — Tengo dolores de cabeza casi permanentes',
    ],
  },
  {
    key: 'q6',
    label: '6. Concentración',
    options: [
      '0 — Me puedo concentrar sin dificultad',
      '1 — Me puedo concentrar con leve dificultad',
      '2 — Me puedo concentrar con alguna dificultad',
      '3 — Tengo bastante dificultad para concentrarme',
      '4 — Tengo mucha dificultad para concentrarme',
      '5 — No me puedo concentrar en absoluto',
    ],
  },
  {
    key: 'q7',
    label: '7. Trabajo',
    options: [
      '0 — Puedo hacer todo el trabajo que quiero',
      '1 — Solo puedo hacer mi trabajo habitual, sin más',
      '2 — Puedo hacer la mayor parte de mi trabajo habitual pero no más',
      '3 — No puedo hacer mi trabajo habitual',
      '4 — Apenas puedo hacer algún trabajo',
      '5 — No puedo trabajar en absoluto',
    ],
  },
  {
    key: 'q8',
    label: '8. Conducir',
    options: [
      '0 — Puedo conducir sin dolor de cuello',
      '1 — Puedo conducir tanto como quiera con leve dolor de cuello',
      '2 — Puedo conducir tanto como quiera con dolor moderado de cuello',
      '3 — No puedo conducir tanto como quiero por dolor moderado de cuello',
      '4 — Apenas puedo conducir por intenso dolor de cuello',
      '5 — No puedo conducir en absoluto',
    ],
  },
  {
    key: 'q9',
    label: '9. Dormir',
    options: [
      '0 — No tengo problemas para dormir',
      '1 — Mi sueño se perturba ligeramente (menos de 1 h sin dormir)',
      '2 — Mi sueño se perturba algo (1–2 h sin dormir)',
      '3 — Mi sueño se perturba moderadamente (2–3 h sin dormir)',
      '4 — Mi sueño se perturba mucho (3–5 h sin dormir)',
      '5 — No puedo dormir (menos de 5 h en total)',
    ],
  },
  {
    key: 'q10',
    label: '10. Actividades de ocio',
    options: [
      '0 — Puedo practicar todas mis actividades de ocio sin dolor de cuello',
      '1 — Puedo practicar todas mis actividades de ocio con algo de dolor de cuello',
      '2 — Puedo practicar la mayoría de actividades de ocio por dolor de cuello',
      '3 — No puedo practicar muchas de mis actividades de ocio por dolor de cuello',
      '4 — Apenas puedo practicar actividades de ocio por dolor de cuello',
      '5 — No puedo practicar ninguna actividad de ocio',
    ],
  },
];

const SCALE_QUESTIONS: Record<ScaleType, ScaleQuestion[]> = {
  OSWESTRY: OSWESTRY_QUESTIONS,
  NDI: NDI_QUESTIONS,
};

const SCALE_LABELS: Record<ScaleType, string> = {
  OSWESTRY: 'Oswestry (ODI)',
  NDI: 'Neck Disability Index (NDI)',
};

// ── Score badge colour ────────────────────────────────────────────────────────

function scoreBadgeClass(score: number): string {
  if (score <= 20) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
  if (score <= 40) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
  if (score <= 60) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  patientId: string;
}

export default function FunctionalScalesTab({ patientId }: Props) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<ScaleType>('OSWESTRY');
  const [responses, setResponses] = useState<Record<string, number>>({});

  const { data: scales = [], isLoading } = useQuery({
    queryKey: functionalScaleKeys.list(patientId),
    queryFn: () => functionalScaleApi.list(patientId),
  });

  const questions = SCALE_QUESTIONS[selectedType];
  const allAnswered = questions.every((q) => responses[q.key] !== undefined);

  function openDialog() {
    setSelectedType('OSWESTRY');
    setResponses({});
    setDialogOpen(true);
  }

  function handleTypeChange(type: ScaleType) {
    setSelectedType(type);
    setResponses({});
  }

  const createMutation = useMutation({
    mutationFn: () =>
      functionalScaleApi.create(patientId, {
        scaleType: selectedType,
        responses,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: functionalScaleKeys.list(patientId) });
      toast.success('Escala guardada');
      setDialogOpen(false);
    },
    onError: () => toast.error('Error al guardar la escala'),
  });

  const deleteMutation = useMutation({
    mutationFn: (scaleId: string) => functionalScaleApi.delete(patientId, scaleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: functionalScaleKeys.list(patientId) });
      toast.success('Escala eliminada');
    },
    onError: () => toast.error('Error al eliminar la escala'),
  });

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Cargando...</div>;
  }

  // Live preview score during form
  const liveScore = (() => {
    const answered = Object.keys(responses).length;
    if (answered === 0) return null;
    const total = Object.values(responses).reduce((s, v) => s + v, 0);
    return Math.round((total / (answered * 5)) * 100);
  })();

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {scales.length === 0
            ? 'Sin escalas registradas'
            : `${scales.length} escala${scales.length !== 1 ? 's' : ''}`}
        </p>
        <Button size="sm" onClick={openDialog}>
          <Plus className="h-4 w-4 mr-1" />
          Nueva escala
        </Button>
      </div>

      {scales.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
          Todavía no hay escalas. Aplicá una escala funcional para monitorear la evolución del paciente.
        </div>
      ) : (
        <div className="space-y-3">
          {scales.map((scale) => (
            <Card key={scale.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{SCALE_LABELS[scale.scaleType]}</span>
                      <Badge variant="outline" className={scoreBadgeClass(scale.score)}>
                        {scale.score}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{scale.interpretation}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(scale.appliedAt).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate(scale.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={scale.score} className="h-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Apply scale dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Aplicar escala funcional</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Scale type selector */}
            <div className="space-y-2">
              <Label>Tipo de escala</Label>
              <Select
                value={selectedType}
                onValueChange={(v) => handleTypeChange(v as ScaleType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OSWESTRY">Oswestry Disability Index (ODI) — Columna lumbar</SelectItem>
                  <SelectItem value="NDI">Neck Disability Index (NDI) — Columna cervical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Live score preview */}
            {liveScore !== null && (
              <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
                <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Score parcial</span>
                    <span className="font-medium">{liveScore}%</span>
                  </div>
                  <Progress value={liveScore} className="h-1.5" />
                </div>
              </div>
            )}

            {/* Questions */}
            <div className="space-y-5">
              {questions.map((q) => (
                <div key={q.key} className="space-y-2">
                  <Label className="text-sm font-medium">{q.label}</Label>
                  <Select
                    value={responses[q.key] !== undefined ? String(responses[q.key]) : ''}
                    onValueChange={(v) =>
                      setResponses((prev) => ({ ...prev, [q.key]: parseInt(v, 10) }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar respuesta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {q.options.map((opt, idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!allAnswered || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Guardando...' : 'Guardar escala'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
