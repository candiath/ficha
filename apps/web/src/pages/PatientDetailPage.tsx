import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileText, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useBeforeUnload, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PulseDot } from '@/components/ui/pulse-dot';
import { BodyDiagram } from '@/components/patients/BodyDiagram';
import PatientFormDialog from '@/components/patients/PatientFormDialog';
import ConsentTab from '@/components/patients/ConsentTab';
import ActivityTimeline from '@/components/patients/ActivityTimeline';
import TreatmentCycleTab from '@/components/patients/TreatmentCycleTab';
import SessionDetailSheet from '@/components/sessions/SessionDetailSheet';
import SessionFormDialog from '@/components/sessions/sessionFormModalWide';
import PainEvolutionChart from '@/components/sessions/PainEvolutionChart';
import { toast } from 'sonner';
import { episodeApi, episodeKeys } from '@/services/episodes';
import type { ClinicalEpisode, EpisodeUpdateData } from '@/types/episode';
import { evaluationApi, evaluationKeys } from '@/services/evaluation';
import { patientApi, patientKeys } from '@/services/patients';
import { sessionApi, sessionKeys } from '@/services/sessions';
import { SEX_CLASS, SEX_LABELS, SESSION_TYPE_CLASS, SESSION_TYPE_LABELS } from '@/lib/labels';
import type { BodyMarker } from '@/types/evaluation';
import type { Session } from '@/types/session';

const evalSchema = z.object({
  occupation: z.string().optional().or(z.literal('')),
  reasonForConsultation: z.string().optional().or(z.literal('')),
  medicalHistory: z.string().optional().or(z.literal('')),
  globalPosture: z.string().optional().or(z.literal('')),
  breathingPattern: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  morphotype: z.string().optional().or(z.literal('')),
  footEvaluation: z.string().optional().or(z.literal('')),
  breathingPatternDetail: z.string().optional().or(z.literal('')),
  flexibilityNotes: z.string().optional().or(z.literal('')),
  physicalActivity: z.string().optional().or(z.literal('')),
  painAppearanceMoment: z.string().optional().or(z.literal('')),
  painFrequency: z.string().optional().or(z.literal('')),
  familyPainAppearance: z.array(z.string()).optional(),
  familyPainDisappearance: z.array(z.string()).optional(),
  evaScale: z.string().optional().or(z.literal('')),
});

type EvalFormValues = z.infer<typeof evalSchema>;

function formatDate(iso: string | null | undefined) {
  if (!iso) return undefined;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getAge(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const today = new Date();
  const birth = new Date(iso);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age} años`;
}

export function DirtyLabel({ label, dirty }: { label: string; dirty?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label}
      {dirty && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          Modificado
        </span>
      )}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const EPISODE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  DISCHARGED: 'Alta',
  ABANDONED: 'Abandonado',
};

const EPISODE_STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  DISCHARGED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ABANDONED: 'bg-gray-100 text-gray-600',
};

function EpisodeCombobox({
  episodes,
  selectedId,
  onSelect,
  onNewEpisode,
}: {
  episodes: ClinicalEpisode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewEpisode: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = episodes.filter(
    (ep) => !search || ep.mainComplaint?.toLowerCase().includes(search.toLowerCase()),
  );

  const selected = episodes.find((e) => e.id === selectedId);
  const selectedLabel = selected
    ? selected.mainComplaint || `Episodio ${episodes.length - episodes.indexOf(selected)}`
    : 'Seleccionar episodio';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border rounded-md bg-background hover:bg-muted transition-colors min-w-[220px] max-w-xs justify-between"
      >
        <span className="truncate text-left">{selectedLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-card border rounded-lg shadow-lg">
          <div className="p-2 border-b">
            <input
              type="text"
              className="w-full px-2 py-1.5 text-sm bg-muted rounded-md outline-none placeholder:text-muted-foreground"
              placeholder="Buscar episodio..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>
            )}
            {filtered.map((ep) => {
              const epNumber = episodes.length - episodes.indexOf(ep);
              const label = ep.mainComplaint || `Episodio ${epNumber}`;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => { onSelect(ep.id); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-start justify-between gap-2 ${
                    ep.id === selectedId ? 'bg-muted/70' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(ep.openedAt).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${EPISODE_STATUS_CLASS[ep.status]}`}>
                    {EPISODE_STATUS_LABELS[ep.status]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="p-2 border-t">
            <button
              type="button"
              onClick={() => { onNewEpisode(); setOpen(false); setSearch(''); }}
              className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-muted rounded-md transition-colors flex items-center gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo episodio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EvaluationTab({ patientId, episodeId, occupation, onUnsavedChangesChange }: { patientId: string; episodeId: string; occupation?: string | null; onUnsavedChangesChange?: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [retractionMap, setRetractionMap] = useState<BodyMarker[]>([]);
  const [retractionMapDirty, setRetractionMapDirty] = useState(false);

  const { data: evaluation, isLoading } = useQuery({
    queryKey: evaluationKeys.detail(patientId, episodeId),
    queryFn: () => evaluationApi.get(patientId, episodeId),
  });

  const form = useForm<EvalFormValues>({
    resolver: zodResolver(evalSchema),
    defaultValues: {
      occupation: '',
      reasonForConsultation: '',
      medicalHistory: '',
      globalPosture: '',
      breathingPattern: '',
      notes: '',
      morphotype: '',
      footEvaluation: '',
      breathingPatternDetail: '',
      flexibilityNotes: '',
      physicalActivity: '',
      painAppearanceMoment: '',
      painFrequency: '',
      familyPainAppearance: [],
      familyPainDisappearance: [],
      evaScale: '',
    },
  });
  const { isDirty, dirtyFields } = form.formState;
  const hasUnsavedChanges = isDirty || retractionMapDirty;

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  // Advertir al cerrar/recargar el browser
  useBeforeUnload(
    useCallback((e) => {
      if (hasUnsavedChanges) e.preventDefault();
    }, [hasUnsavedChanges]),
  );

  // Pre-fill when data loads (evaluation may be null on first visit)
  useEffect(() => {
    form.setValue('occupation', occupation ?? '');
  }, [occupation, form]);

  useEffect(() => {
    if (evaluation) {
      form.reset({
        occupation: occupation ?? '',
        reasonForConsultation: evaluation.reasonForConsultation ?? '',
        medicalHistory: evaluation.medicalHistory ?? '',
        globalPosture: evaluation.globalPosture ?? '',
        breathingPattern: evaluation.breathingPattern ?? '',
        notes: evaluation.notes ?? '',
        morphotype: evaluation.morphotype ?? '',
        footEvaluation: evaluation.footEvaluation ?? '',
        breathingPatternDetail: evaluation.breathingPatternDetail ?? '',
        flexibilityNotes: evaluation.flexibilityNotes ?? '',
        physicalActivity: evaluation.physicalActivity ?? '',
        painAppearanceMoment: evaluation.painAppearanceMoment ?? '',
        painFrequency: evaluation.painFrequency ?? '',
        familyPainAppearance: (evaluation.familyPainAppearance as string[] | null) ?? [],
        familyPainDisappearance: (evaluation.familyPainDisappearance as string[] | null) ?? [],
        evaScale: evaluation.evaScale ? String(evaluation.evaScale) : '',
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetractionMap(evaluation.retractionMap ?? []);
      setRetractionMapDirty(false);
    }
  }, [evaluation, form, occupation]);

  const mutation = useMutation({
    mutationFn: async (values: EvalFormValues) => {
      const evalPromise = evaluationApi.upsert(patientId, episodeId, {
        reasonForConsultation: values.reasonForConsultation || null,
        medicalHistory: values.medicalHistory || null,
        globalPosture: values.globalPosture || null,
        breathingPattern: values.breathingPattern || null,
        notes: values.notes || null,
        morphotype: values.morphotype || null,
        retractionMap: retractionMap.length > 0 ? retractionMap : null,
        footEvaluation: values.footEvaluation || null,
        breathingPatternDetail: values.breathingPatternDetail || null,
        flexibilityNotes: values.flexibilityNotes || null,
        physicalActivity: values.physicalActivity || null,
        painAppearanceMoment: values.painAppearanceMoment || null,
        painFrequency: values.painFrequency || null,
        familyPainAppearance: values.familyPainAppearance?.length ? values.familyPainAppearance : null,
        familyPainDisappearance: values.familyPainDisappearance?.length ? values.familyPainDisappearance : null,
        evaScale: values.evaScale ? Number(values.evaScale) : null,
      });
      const newOccupation = values.occupation || null;
      if (newOccupation !== (occupation ?? null)) {
        await patientApi.update(patientId, { occupation: newOccupation });
      }
      return evalPromise;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evaluationKeys.detail(patientId, episodeId) });
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      setRetractionMapDirty(false);
      toast.success('Evaluación guardada');
    },
  });

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Cargando...</div>;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Evaluación inicial</CardTitle>
            {evaluation && (
              <p className="text-xs text-muted-foreground">
                Última actualización:{' '}
                {new Date(evaluation.updatedAt).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">

            <FormField
              control={form.control}
              name="physicalActivity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Realiza actividad física" dirty={dirtyFields.physicalActivity} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descripción de la actividad física que realiza..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="occupation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Ocupación" dirty={dirtyFields.occupation} /></FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Docente, oficinista, deportista..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="painAppearanceMoment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Momento de aparición del dolor" dirty={dirtyFields.painAppearanceMoment} /></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej: Por las mañanas, después de actividad, en reposo..."
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="painFrequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Frecuencia del dolor" dirty={dirtyFields.painFrequency} /></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej: Diario, intermitente, solo al moverse..."
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

                        {/* Escala EVA */}
            <FormField
              control={form.control}
              name="evaScale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Escala EVA (cuando siente dolor)" dirty={dirtyFields.evaScale} /></FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      max="10"
                      placeholder="0-10"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Card demo — Dolor en familia (columnas) */}
            <Card className="border-dashed">
              <CardHeader className="pb-3 pt-4 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  Dolor en familia — columnas
                  <PulseDot variant="demo" />
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="familyPainAppearance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">Aparición</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            {(['1', '2', '3', '4'] as const).map((id) => {
                              const active = field.value?.includes(id);
                              return (
                                <div
                                  key={id}
                                  className={`flex items-center space-x-2 p-2 rounded-md border cursor-pointer transition-colors ${
                                    active ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                                  }`}
                                  onClick={() =>
                                    field.onChange(
                                      active
                                        ? (field.value ?? []).filter((v) => v !== id)
                                        : [...(field.value ?? []), id]
                                    )
                                  }
                                >
                                  <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                                    {active && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </span>
                                  <span className="text-sm flex-1">{id}</span>
                                </div>
                              );
                            })}
                          </div>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="familyPainDisappearance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-muted-foreground">Desaparición</FormLabel>
                        <FormControl>
                          <div className="space-y-2">
                            {(['1', '2', '3', '4'] as const).map((id) => {
                              const active = field.value?.includes(id);
                              return (
                                <div
                                  key={id}
                                  className={`flex items-center space-x-2 p-2 rounded-md border cursor-pointer transition-colors ${
                                    active ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                                  }`}
                                  onClick={() =>
                                    field.onChange(
                                      active
                                        ? (field.value ?? []).filter((v) => v !== id)
                                        : [...(field.value ?? []), id]
                                    )
                                  }
                                >
                                  <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                                    {active && <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </span>
                                  <span className="text-sm flex-1">{id}</span>
                                </div>
                              );
                            })}
                          </div>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <FormField
              control={form.control}
              name="reasonForConsultation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Motivo de consulta" dirty={dirtyFields.reasonForConsultation} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="¿Por qué consulta el paciente?"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="medicalHistory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Historia clínica" dirty={dirtyFields.medicalHistory} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Antecedentes relevantes, diagnósticos previos..."
                      className="resize-none"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="globalPosture"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Postura global" dirty={dirtyFields.globalPosture} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Observaciones posturales..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Agrupar morphotype y breathingPatternDetail en columnas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="morphotype"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Morfotipo" dirty={dirtyFields.morphotype} /></FormLabel>
                    <FormControl>
                      <Input placeholder="Inspiratorio-retraído, abierto..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="breathingPatternDetail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Patrón respiratorio detallado" dirty={dirtyFields.breathingPatternDetail} /></FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="costal_superior">Costal superior</SelectItem>
                        <SelectItem value="diafragmatico">Diafragmático</SelectItem>
                        <SelectItem value="abdominal">Abdominal</SelectItem>
                        <SelectItem value="paradojico">Paradójico</SelectItem>
                        <SelectItem value="mixto">Mixto</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Patrón respiratorio (notas) */}
            <FormField
              control={form.control}
              name="breathingPattern"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Patrón respiratorio (notas)" dirty={dirtyFields.breathingPattern} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Detalles adicionales sobre la respiración..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Evaluación de pies */}
            <FormField
              control={form.control}
              name="footEvaluation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Evaluación de pies" dirty={dirtyFields.footEvaluation} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Pie plano, cavo, valgo, varo..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notas de flexibilidad y acortamientos */}
            <FormField
              control={form.control}
              name="flexibilityNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Test de flexibilidad / acortamientos" dirty={dirtyFields.flexibilityNotes} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Isquiotibiales, psoas, trapecio superior..."
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />



            <Separator />

            {/* Mapa corporal */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Mapa corporal — Retracciones</h3>
              <p className="text-xs text-muted-foreground">
                Marcá zonas de retracción, dolor o alteración en el diagrama.
                Los cambios se guardan junto con la evaluación.
              </p>
              <BodyDiagram
                markers={retractionMap}
                onAddMarker={(marker) => {
                  setRetractionMap((prev) => [...prev, { ...marker, id: crypto.randomUUID() }]);
                  setRetractionMapDirty(true);
                }}
                onRemoveMarker={(id) => {
                  setRetractionMap((prev) => prev.filter((m) => m.id !== id));
                  setRetractionMapDirty(true);
                }}
              />
            </div>

            <Separator />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel><DirtyLabel label="Notas adicionales" dirty={dirtyFields.notes} /></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Cualquier otra observación relevante..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end pt-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button type="submit" disabled={mutation.isPending || !hasUnsavedChanges}>
                        {mutation.isPending ? 'Guardando...' : 'Guardar evaluación'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!hasUnsavedChanges && (
                    <TooltipContent>
                      <p>No hay cambios para guardar</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardContent>
        </Card>
      </form>

    </Form>
  );
}

const SESSIONS_PAGE_SIZE = 8;

function SessionsTab({
  patientId,
  episodeId,
  episodeStatus,
  onNewEpisode,
}: {
  patientId: string;
  episodeId: string;
  episodeStatus: string;
  onNewEpisode: () => void;
}) {
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [closedWarning, setClosedWarning] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [page, setPage] = useState(0);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: sessionKeys.list(patientId, episodeId),
    queryFn: () => sessionApi.list(patientId, episodeId),
  });

  const reopenMutation = useMutation({
    mutationFn: () => episodeApi.update(patientId, episodeId, { status: 'ACTIVE', closedAt: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(patientId) });
      toast.success('Episodio reabierto');
      setClosedWarning(false);
      setNewOpen(true);
    },
    onError: () => toast.error('No se pudo reabrir el episodio'),
  });

  const dischargeSession = sessions.find((s) => s.sessionType === 'DISCHARGE') ?? null;
  const dischargeDate = dischargeSession
    ? new Date(dischargeSession.sessionDate).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  function handleNewSession() {
    if (episodeStatus !== 'ACTIVE') {
      setClosedWarning(true);
    } else {
      setNewOpen(true);
    }
  }

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Cargando...</div>;
  }

  return (
    <>
      {/* Gráfico de evolución del dolor */}
      <PainEvolutionChart sessions={sessions} />

      {/* Header de sección */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {sessions.length === 0
            ? 'Sin sesiones registradas'
            : `${sessions.length} sesión${sessions.length !== 1 ? 'es' : ''}`}
        </p>
        <Button size="sm" onClick={handleNewSession}>
          <Plus className="h-4 w-4 mr-1" />
          Nueva sesión
        </Button>
      </div>

      {/* Advertencia: episodio cerrado */}
      <Dialog open={closedWarning} onOpenChange={setClosedWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Episodio cerrado</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  {dischargeDate
                    ? <>Este paciente fue dado de alta el <span className="font-medium text-foreground">{dischargeDate}</span>.</>
                    : 'Este episodio está cerrado.'}
                </p>
                {dischargeSession && (
                  <button
                    type="button"
                    className="text-sm text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setClosedWarning(false);
                      setSelected(dischargeSession);
                    }}
                  >
                    Ver nota de alta
                  </button>
                )}
                <p>Para crear una nueva sesión, debes reabrir el episodio.</p>
                
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              disabled={reopenMutation.isPending}
              onClick={() => reopenMutation.mutate()}
            >
              Reabrir episodio
            </Button>
            <Button
              onClick={() => {
                setClosedWarning(false);
                onNewEpisode();
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Nuevo episodio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lista de sesiones */}
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg">
          <p className="font-medium">Sin sesiones</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Registrá la primera sesión con el botón de arriba.
          </p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {sessions.slice(page * SESSIONS_PAGE_SIZE, (page + 1) * SESSIONS_PAGE_SIZE).map((session) => {
            const globalIdx = sessions.indexOf(session);
            const date = new Date(session.sessionDate);
            const formattedDate = date.toLocaleDateString('es-AR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            });
            const sessionNumber = sessions.length - globalIdx;
            const hasPain =
              session.painScaleBefore !== null || session.painScaleAfter !== null;

            return (
              <button
                key={session.id}
                type="button"
                className="w-full text-left"
                onClick={() => setSelected(session)}
              >
                <Card className="hover:bg-muted/40 transition-colors cursor-pointer">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Número de sesión */}
                        <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {sessionNumber}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium capitalize">{formattedDate}</p>
                          {/* Preview de observaciones */}
                          {session.observations && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                              {session.observations}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Escalas de dolor */}
                        {hasPain && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {session.painScaleBefore ?? '—'}
                            {' → '}
                            {session.painScaleAfter ?? '—'}
                          </span>
                        )}
                        <Badge variant="outline" className={SESSION_TYPE_CLASS[session.sessionType]}>
                          {SESSION_TYPE_LABELS[session.sessionType]}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        {/* Pagination */}
        {sessions.length > SESSIONS_PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              {page * SESSIONS_PAGE_SIZE + 1}–{Math.min((page + 1) * SESSIONS_PAGE_SIZE, sessions.length)} de {sessions.length}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-2">
                {page + 1} / {Math.ceil(sessions.length / SESSIONS_PAGE_SIZE)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * SESSIONS_PAGE_SIZE >= sessions.length}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      <SessionFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        patientId={patientId}
        episodeId={episodeId}
        onSuccess={() => setPage(0)}
      />

      <SessionDetailSheet
        session={selected}
        patientId={patientId}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

const TAB_COMPONENT: Record<string, string> = {
  resumen: 'PatientDetailPage',
  evaluacion: 'EvaluationTab',
  sesiones: 'SessionsTab',
  plan: 'TreatmentCycleTab',
  consentimiento: 'ConsentTab',
  actividad: 'ActivityTimeline',
};

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('resumen');
  const [evalHasChanges, setEvalHasChanges] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false);
  const [newEpisodeComplaint, setNewEpisodeComplaint] = useState('');
  const [editEpisodeOpen, setEditEpisodeOpen] = useState(false);
  const [editEpisodeComplaint, setEditEpisodeComplaint] = useState('');
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const {
    data: patient,
    isLoading,
    isError,
  } = useQuery({
    queryKey: patientKeys.detail(id!),
    queryFn: () => patientApi.get(id!),
    enabled: !!id,
  });

  const { data: episodes = [] } = useQuery({
    queryKey: episodeKeys.list(id!),
    queryFn: () => episodeApi.list(id!),
    enabled: !!id,
  });

  // Episodio efectivo: selección manual del usuario, o el primer ACTIVE, o el primero de la lista
  const effectiveEpisodeId: string | null =
    activeEpisodeId ??
    (episodes.find((e) => e.status === 'ACTIVE') ?? episodes[0])?.id ??
    null;

  const createEpisodeMutation = useMutation({
    mutationFn: (complaint: string) =>
      episodeApi.create(id!, { mainComplaint: complaint || null }),
    onSuccess: (newEpisode) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(id!) });
      setActiveEpisodeId(newEpisode.id);
      setNewEpisodeOpen(false);
      setNewEpisodeComplaint('');
    },
  });

  const updateEpisodeMutation = useMutation({
    mutationFn: (data: EpisodeUpdateData) =>
      episodeApi.update(id!, effectiveEpisodeId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(id!) });
      setEditEpisodeOpen(false);
      setConfirmAbandon(false);
    },
  });

  useEffect(() => { document.title = TAB_COMPONENT[activeTab] ?? 'PatientDetailPage'; }, [activeTab]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;
  }

  if (isError || !patient) {
    return <div className="p-6 text-sm text-destructive">Paciente no encontrado.</div>;
  }

  const age = getAge(patient.birthDate);
  const birthFormatted = formatDate(patient.birthDate);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Volver */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 mb-4 text-muted-foreground"
        onClick={() => {
          if (evalHasChanges) {
            setPendingAction(() => () => navigate('/patients'));
          } else {
            navigate('/patients');
          }
        }}
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Pacientes
      </Button>

      {/* Encabezado */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{patient.fullName}</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Paciente desde {formatDate(patient.createdAt)}
            {age && ` · ${age}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* El <span> es necesario: un button deshabilitado no dispara
                    los eventos de mouse que el Tooltip necesita para mostrarse */}
                <span className="inline-flex">
                  <Button variant="outline" disabled>
                    <FileText className="h-4 w-4 mr-2" />
                    Descargar informe
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Próximamente</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Editar
          </Button>
        </div>
      </div>

      {/* Episodios — CTA si no hay ninguno, combobox si hay */}
      {episodes.length === 0 ? (
        <Card className="mb-6 border-dashed">
          <CardContent className="py-8 flex flex-col items-center text-center gap-3">
            <div className="rounded-full bg-muted p-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-sm">Sin episodios clínicos</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Registrá la primera consulta para comenzar a trabajar con este paciente.
              </p>
            </div>
            <Button size="sm" onClick={() => setNewEpisodeOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Registrar primera consulta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium shrink-0">Episodio:</span>
          <EpisodeCombobox
            episodes={episodes}
            selectedId={effectiveEpisodeId}
            onSelect={setActiveEpisodeId}
            onNewEpisode={() => setNewEpisodeOpen(true)}
          />
          {effectiveEpisodeId && (
            <button
              type="button"
              title="Editar motivo del episodio"
              onClick={() => {
                const ep = episodes.find((e) => e.id === effectiveEpisodeId);
                setEditEpisodeComplaint(ep?.mainComplaint ?? '');
                setConfirmAbandon(false);
                setEditEpisodeOpen(true);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {effectiveEpisodeId && episodes.find((e) => e.id === effectiveEpisodeId)?.status !== 'ACTIVE' && (
            <span className="text-xs text-muted-foreground">
              Episodio cerrado.{' '}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => setNewEpisodeOpen(true)}
              >
                ¿Nueva consulta?
              </button>
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(tab) => {
        if (evalHasChanges && activeTab === 'evaluacion') {
          setPendingAction(() => () => setActiveTab(tab));
        } else {
          setActiveTab(tab);
        }
      }}>
        <TabsList variant="line">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="evaluacion">Evaluación inicial</TabsTrigger>
          <TabsTrigger value="sesiones">Sesiones</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="consentimiento">Consentimiento</TabsTrigger>
          <TabsTrigger value="actividad">Actividad</TabsTrigger>
        </TabsList>
        <Separator />

        {/* ── Resumen ── */}
        <TabsContent value="resumen" className="mt-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Datos personales</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                <DetailField label="Nombre completo" value={patient.fullName} />
                <DetailField
                  label="Sexo"
                  value={
                    patient.sex ? (
                      <Badge variant="outline" className={SEX_CLASS[patient.sex]}>{SEX_LABELS[patient.sex]}</Badge>
                    ) : undefined
                  }
                />
                <DetailField
                  label="Fecha de nacimiento"
                  value={
                    birthFormatted
                      ? `${birthFormatted}${age ? ` (${age})` : ''}`
                      : undefined
                  }
                />
                <DetailField label="Teléfono" value={patient.phone} />
                <DetailField label="Ocupación" value={patient.occupation} />
                <DetailField label="Médico derivante" value={patient.referringDoctor} />
                {(patient.insuranceName || patient.insuranceNumber || patient.insurancePlan) && (
                  <>
                    <div className="col-span-2 border-t mt-1 pt-1" />
                    <DetailField label="Obra social" value={patient.insuranceName} />
                    <DetailField label="N° afiliado" value={patient.insuranceNumber} />
                    <DetailField label="Plan" value={patient.insurancePlan} />
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Evaluación inicial ── */}
        <TabsContent value="evaluacion" className="mt-6">
          {effectiveEpisodeId ? (
            <EvaluationTab
              patientId={id!}
              episodeId={effectiveEpisodeId}
              occupation={patient.occupation}
              onUnsavedChangesChange={setEvalHasChanges}
            />
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              Seleccioná un episodio para ver la evaluación.
            </div>
          )}
        </TabsContent>

        {/* ── Sesiones ── */}
        <TabsContent value="sesiones" className="mt-6">
          {effectiveEpisodeId ? (
            <SessionsTab
              patientId={id!}
              episodeId={effectiveEpisodeId}
              episodeStatus={episodes.find((e) => e.id === effectiveEpisodeId)?.status ?? 'ACTIVE'}
              onNewEpisode={() => setNewEpisodeOpen(true)}
            />
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              Seleccioná un episodio para ver las sesiones.
            </div>
          )}
        </TabsContent>

        {/* ── Plan ── */}
        <TabsContent value="plan" className="mt-6">
          {effectiveEpisodeId ? (
            <TreatmentCycleTab patientId={id!} episodeId={effectiveEpisodeId} />
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              Seleccioná un episodio para ver el plan de tratamiento.
            </div>
          )}
        </TabsContent>

        {/* ── Consentimiento ── */}
        <TabsContent value="consentimiento" className="mt-6">
          <ConsentTab patient={patient} />
        </TabsContent>

        {/* ── Actividad ── */}
        <TabsContent value="actividad" className="mt-6">
          <ActivityTimeline patientId={id!} />
        </TabsContent>
      </Tabs>

      {/* Dialog: Nuevo episodio */}
      <Dialog open={newEpisodeOpen} onOpenChange={setNewEpisodeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo episodio clínico</DialogTitle>
            <DialogDescription>
              Creá un nuevo episodio para registrar una reincidencia o un nuevo motivo de consulta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo de consulta</label>
            <Input
              placeholder="Ej: Dolor cervical, lesión de hombro..."
              value={newEpisodeComplaint}
              onChange={(e) => setNewEpisodeComplaint(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewEpisodeOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createEpisodeMutation.mutate(newEpisodeComplaint)}
              disabled={createEpisodeMutation.isPending}
            >
              {createEpisodeMutation.isPending ? 'Creando...' : 'Crear episodio'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar episodio (motivo + estado) */}
      <Dialog open={editEpisodeOpen} onOpenChange={(o) => { setEditEpisodeOpen(o); setConfirmAbandon(false); }}>
        <DialogContent>
          {confirmAbandon ? (
            <>
              <DialogHeader>
                <DialogTitle>¿Marcar como abandonado?</DialogTitle>
                <DialogDescription>
                  El episodio se cerrará sin alta formal. El paciente no tiene sesiones de cierre registradas.
                  Podrás reactivarlo en cualquier momento.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmAbandon(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => updateEpisodeMutation.mutate({ status: 'ABANDONED', closedAt: new Date().toISOString() })}
                  disabled={updateEpisodeMutation.isPending}
                >
                  {updateEpisodeMutation.isPending ? 'Guardando...' : 'Confirmar abandono'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Editar episodio</DialogTitle>
                <DialogDescription>
                  Modificá el motivo de consulta o el estado del episodio.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-sm font-medium">Motivo de consulta</label>
                <Input
                  placeholder="Ej: Dolor lumbar, cervicalgia..."
                  value={editEpisodeComplaint}
                  onChange={(e) => setEditEpisodeComplaint(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateEpisodeMutation.mutate({ mainComplaint: editEpisodeComplaint || null });
                  }}
                  autoFocus
                />
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {episodes.find((e) => e.id === effectiveEpisodeId)?.status === 'ACTIVE' ? (
                    
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" className="text-xs" onClick={() => setConfirmAbandon(true)}>
                          Registrar abandono
                        </Button>
                        
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Elegí esta opción si el paciente deja de asistir sin alta formal. Podés reactivarlo si regresa.</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={() => updateEpisodeMutation.mutate({ status: 'ACTIVE', closedAt: null })}
                      disabled={updateEpisodeMutation.isPending}
                    >
                      Reactivar episodio
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditEpisodeOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => updateEpisodeMutation.mutate({ mainComplaint: editEpisodeComplaint || null })}
                    disabled={updateEpisodeMutation.isPending}
                  >
                    {updateEpisodeMutation.isPending ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PatientFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        patient={patient}
      />

      <Dialog open={pendingAction !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Descartar cambios?</DialogTitle>
            <DialogDescription>
              Tenés cambios sin guardar en la evaluación. Si navegás ahora, se perderán.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => {
              pendingAction?.();
              setPendingAction(null);
            }}>
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
