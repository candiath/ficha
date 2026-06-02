import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
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
import { BodyDiagram } from '@/components/patients/BodyDiagram';
import PatientFormDialog from '@/components/patients/PatientFormDialog';
import ConsentTab from '@/components/patients/ConsentTab';
import ActivityTimeline from '@/components/patients/ActivityTimeline';
import TreatmentCycleTab from '@/components/patients/TreatmentCycleTab';
import FunctionalScalesTab from '@/components/patients/FunctionalScalesTab';
import SessionDetailSheet from '@/components/sessions/SessionDetailSheet';
import SessionFormDialog from '@/components/sessions/sessionFormModalWide';
import PainEvolutionChart from '@/components/sessions/PainEvolutionChart';
import { evaluationApi, evaluationKeys } from '@/services/evaluation';
import { patientApi, patientKeys } from '@/services/patients';
import { sessionApi, sessionKeys } from '@/services/sessions';
import { SEX_CLASS, SEX_LABELS, SESSION_TYPE_CLASS, SESSION_TYPE_LABELS } from '@/lib/labels';
import type { BodyMarker } from '@/types/evaluation';
import type { Session } from '@/types/session';

const evalSchema = z.object({
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

function EvaluationTab({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [retractionMap, setRetractionMap] = useState<BodyMarker[]>([]);

  const { data: evaluation, isLoading } = useQuery({
    queryKey: evaluationKeys.detail(patientId),
    queryFn: () => evaluationApi.get(patientId),
  });

  const form = useForm<EvalFormValues>({
    resolver: zodResolver(evalSchema),
    defaultValues: {
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
      familyPainAppearance: [],
      familyPainDisappearance: [],
      evaScale: '',
    },
  });

  // Pre-fill when data loads
  useEffect(() => {
    if (evaluation) {
      form.reset({
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
        familyPainAppearance: (evaluation.familyPainAppearance as string[] | null) ?? [],
        familyPainDisappearance: (evaluation.familyPainDisappearance as string[] | null) ?? [],
        evaScale: evaluation.evaScale ? String(evaluation.evaScale) : '',
      });
      setRetractionMap(evaluation.retractionMap ?? []);
    }
  }, [evaluation, form]);

  const mutation = useMutation({
    mutationFn: (values: EvalFormValues) =>
      evaluationApi.upsert(patientId, {
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
        familyPainAppearance: values.familyPainAppearance?.length ? values.familyPainAppearance : null,
        familyPainDisappearance: values.familyPainDisappearance?.length ? values.familyPainDisappearance : null,
        evaScale: values.evaScale ? Number(values.evaScale) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evaluationKeys.detail(patientId) });
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
              name="reasonForConsultation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo de consulta</FormLabel>
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
                  <FormLabel>Historia clínica</FormLabel>
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
                  <FormLabel>Postura global</FormLabel>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="morphotype"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Morfotipo</FormLabel>
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
                    <FormLabel>Patrón respiratorio detallado</FormLabel>
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

            <FormField
              control={form.control}
              name="breathingPattern"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Patrón respiratorio (notas)</FormLabel>
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

            <FormField
              control={form.control}
              name="footEvaluation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Evaluación de pies</FormLabel>
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

            <FormField
              control={form.control}
              name="flexibilityNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Test de flexibilidad / acortamientos</FormLabel>
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

            <FormField
              control={form.control}
              name="physicalActivity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Realiza actividad física</FormLabel>
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
              name="painAppearanceMoment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Momento de aparición del dolor</FormLabel>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="familyPainAppearance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aparición del dolor en familia</FormLabel>
                    <FormControl>
                      <div className="space-y-2">
                        <Select value="" onValueChange={(value) => {
                          if (value && !field.value?.includes(value)) {
                            field.onChange([...(field.value ?? []), value]);
                          }
                        }}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar familia..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Familia 1</SelectItem>
                            <SelectItem value="2">Familia 2</SelectItem>
                            <SelectItem value="3">Familia 3</SelectItem>
                            <SelectItem value="4">Familia 4</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex flex-wrap gap-2">
                          {field.value?.map((familyId) => (
                            <span key={familyId} className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded-full text-xs">
                              Familia {familyId}
                              <button
                                type="button"
                                onClick={() => field.onChange(field.value?.filter(id => id !== familyId) ?? [])}
                                className="ml-1 hover:opacity-70"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="familyPainDisappearance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Desaparición del dolor en familia</FormLabel>
                    <FormControl>
                      <div className="space-y-2">
                        <Select value="" onValueChange={(value) => {
                          if (value && !field.value?.includes(value)) {
                            field.onChange([...(field.value ?? []), value]);
                          }
                        }}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar familia..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Familia 1</SelectItem>
                            <SelectItem value="2">Familia 2</SelectItem>
                            <SelectItem value="3">Familia 3</SelectItem>
                            <SelectItem value="4">Familia 4</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex flex-wrap gap-2">
                          {field.value?.map((familyId) => (
                            <span key={familyId} className="inline-flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded-full text-xs">
                              Familia {familyId}
                              <button
                                type="button"
                                onClick={() => field.onChange(field.value?.filter(id => id !== familyId) ?? [])}
                                className="ml-1 hover:opacity-70"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="evaScale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Escala EVA (cuando siente dolor)</FormLabel>
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
                onAddMarker={(marker) =>
                  setRetractionMap((prev) => [
                    ...prev,
                    { ...marker, id: crypto.randomUUID() },
                  ])
                }
                onRemoveMarker={(id) =>
                  setRetractionMap((prev) => prev.filter((m) => m.id !== id))
                }
              />
            </div>

            <Separator />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas adicionales</FormLabel>
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
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar evaluación'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}

const SESSIONS_PAGE_SIZE = 8;

function SessionsTab({ patientId }: { patientId: string }) {
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Session | null>(null);
  const [page, setPage] = useState(0);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: sessionKeys.list(patientId),
    queryFn: () => sessionApi.list(patientId),
  });

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
        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Nueva sesión
        </Button>
      </div>

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
  escalas: 'FunctionalScalesTab',
  consentimiento: 'ConsentTab',
  actividad: 'ActivityTimeline',
};

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('resumen');

  const {
    data: patient,
    isLoading,
    isError,
  } = useQuery({
    queryKey: patientKeys.detail(id!),
    queryFn: () => patientApi.get(id!),
    enabled: !!id,
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
        onClick={() => navigate('/patients')}
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
          <Button variant="outline" disabled>
            <FileText className="h-4 w-4 mr-2" />
            Descargar informe
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Editar
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="evaluacion">Evaluación inicial</TabsTrigger>
          <TabsTrigger value="sesiones">Sesiones</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="escalas">Escalas</TabsTrigger>
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
          <EvaluationTab patientId={id!} />
        </TabsContent>

        {/* ── Sesiones ── */}
        <TabsContent value="sesiones" className="mt-6">
          <SessionsTab patientId={id!} />
        </TabsContent>

        {/* ── Plan ── */}
        <TabsContent value="plan" className="mt-6">
          <TreatmentCycleTab patientId={id!} />
        </TabsContent>

        {/* ── Escalas ── */}
        <TabsContent value="escalas" className="mt-6">
          <FunctionalScalesTab patientId={id!} />
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

      <PatientFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        patient={patient}
      />
    </div>
  );
}
