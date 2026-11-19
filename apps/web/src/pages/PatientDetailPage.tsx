import { zodResolver } from '@hookform/resolvers/zod';
import { DOCUMENT_TYPE_LABELS } from '@ficha/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileText, Link2, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ageOnDay, formatDay } from '@/lib/calendarDate';
import { useUnsavedChanges } from '@/lib/unsavedChanges';
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
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DirtyLabel } from '@/components/ui/dirty-label';
import AbandonEpisodeConfirm from '@/components/patients/AbandonEpisodeConfirm';
import PatientFormDialog from '@/components/patients/PatientFormDialog';
import RevisionReasonField from '@/components/patients/RevisionReasonField';
import { useRevisionReason } from '@/hooks/useRevisionReason';
import StaleRecordNotice from '@/components/patients/StaleRecordNotice'
import { isStaleEdit } from '@/lib/staleEdit';
import { PatientHistoryCard } from '@/components/patients/PatientHistoryCard';
import ActivityTimeline from '@/components/patients/ActivityTimeline';
import EncounterFormDialog from '@/components/encounters/EncounterFormModalWide';
import { EncounterTypeBadge } from '@/components/encounters/EncounterTypeBadge';
import PainEvolutionChart from '@/components/encounters/PainEvolutionChart';
import { toast } from 'sonner';
import { episodeApi, episodeKeys } from '@/services/episodes';
import type { ClinicalEpisode, EpisodeUpdateData } from '@/types/episode';
import { evaluationApi, evaluationKeys } from '@/services/evaluation';
import { patientApi, patientKeys } from '@/services/patients';
import { encounterApi, encounterKeys } from '@/services/encounters';
import {
  EPISODE_STATUS_CLASS,
  EPISODE_STATUS_LABELS,
  SEX_CLASS,
  SEX_LABELS,
} from '@/lib/labels';
import { blockFor, type Encounter } from '@/types/encounter';
import RevisionHistoryDialog, { RevisionHistoryButton } from '@/components/patients/RevisionHistoryDialog';
import { renderEpisodeSnapshot, renderEvaluationSnapshot, renderPatientSnapshot, renderEncounterSnapshot } from '@/lib/revisionRows';
import { revisionPaths } from '@/services/revisions';

const evalSchema = z.object({
  occupation: z.string(),
  patientNarrative: z.string(),
  otherHistory: z.string(),
  notes: z.string(),
  physicalActivity: z.string(),
  painFrequency: z.string(),
  painScale: z.string().optional().or(z.literal('')),
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

function getAge(day: string | null | undefined): string | undefined {
  const age = ageOnDay(day);
  return age === null ? undefined : `${age} años`;
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

// The patient's occupation is edited here too, so the tab carries her version.
function EvaluationTab({ patientId, episodeId, occupation, patientVersion, onUnsavedChangesChange }: { patientId: string; episodeId: string; occupation?: string | null; patientVersion?: number; onUnsavedChangesChange?: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  // A correction says why (SPEC-clinical-revisions.md §4); the first
  // evaluation does not, unless it also corrects the patient's occupation.
  const revision = useRevisionReason();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: evaluation, isLoading } = useQuery({
    queryKey: evaluationKeys.detail(patientId, episodeId),
    queryFn: () => evaluationApi.get(patientId, episodeId),
  });

  const form = useForm<EvalFormValues>({
    resolver: zodResolver(evalSchema),
    defaultValues: {
      occupation: '',
      patientNarrative: '',
      otherHistory: '',
      notes: '',
      physicalActivity: '',
      painFrequency: '',
      painScale: '',
    },
  });
  const { isDirty, dirtyFields } = form.formState;
  const hasUnsavedChanges = isDirty;

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);
  // Gone with the form: a tab switch or a discard unmounts it, and nothing is
  // left to ask about.
  useEffect(() => () => onUnsavedChangesChange?.(false), [onUnsavedChangesChange]);

  // Advertir al cerrar/recargar el browser, y al aviso de versión nueva
  // (lib/unsavedChanges.ts).
  useUnsavedChanges(hasUnsavedChanges);

  // Pre-fill when data loads (evaluation may be null on first visit)
  useEffect(() => {
    form.setValue('occupation', occupation ?? '');
  }, [occupation, form]);

  useEffect(() => {
    if (evaluation) {
      form.reset({
        occupation: occupation ?? '',
        patientNarrative: evaluation.patientNarrative ?? '',
        otherHistory: evaluation.otherHistory ?? '',
        notes: evaluation.notes ?? '',
        physicalActivity: evaluation.physicalActivity ?? '',
        painFrequency: evaluation.painFrequency ?? '',
        painScale: evaluation.painScale ? String(evaluation.painScale) : '',
      });
    }
  }, [evaluation, form, occupation]);

  const mutation = useMutation({
    mutationFn: async (values: EvalFormValues) => {
      // Over the versions on screen: the first evaluation is version 0. Two
      // requests, as before: if the second is refused, the first one stays.
      const saved = await evaluationApi.upsert(patientId, episodeId, {
        patientNarrative: values.patientNarrative,
        otherHistory: values.otherHistory,
        notes: values.notes,
        physicalActivity: values.physicalActivity,
        painFrequency: values.painFrequency,
        painScale: values.painScale ? Number(values.painScale) : null,
        expectedVersion: evaluation?.version ?? 0,
        ...(evaluation ? { reason: revision.reason ?? undefined, reasonNote: revision.note } : {}),
      });
      if (values.occupation !== (occupation ?? '')) {
        await patientApi.update(patientId, {
          occupation: values.occupation,
          expectedVersion: patientVersion,
          reason: revision.reason ?? undefined,
          reasonNote: revision.note,
        });
      }
      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: evaluationKeys.detail(patientId, episodeId) });
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      revision.reset();
      toast.success('Evaluación guardada');
    },
    onError: (err: Error) => {
      if (isStaleEdit(err)) {
        setStaleMessage(err.message);
        return;
      }
      toast.error(err.message || 'No se pudo guardar la evaluación');
    },
  });

  // After a 409: the evaluation and the patient as they are now replace the form.
  async function reload() {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: evaluationKeys.detail(patientId, episodeId) }),
      queryClient.refetchQueries({ queryKey: patientKeys.detail(patientId), exact: true }),
    ]);
    setStaleMessage(null);
  }
  const correcting = !!evaluation || !!dirtyFields.occupation;

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      {/* The patient's history: hers, not the episode's, with its own saves. */}
      <PatientHistoryCard patientId={patientId} />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => {
            if (correcting && !revision.require()) return;
            mutation.mutate(v);
          })}
        >
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Evaluación inicial</CardTitle>
                {evaluation && <RevisionHistoryButton onClick={() => setHistoryOpen(true)} />}
              </div>
              {evaluation && (
                <RevisionHistoryDialog
                  open={historyOpen}
                  onOpenChange={setHistoryOpen}
                  patientId={patientId}
                  base={revisionPaths.evaluation(patientId, episodeId)}
                  title="Historial de la evaluación inicial"
                  render={renderEvaluationSnapshot}
                />
              )}
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
                name="patientNarrative"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Relato del paciente" dirty={dirtyFields.patientNarrative} /></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="¿Qué le pasó? ¿Cómo empezó? ¿A qué lo atribuye?"
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
                name="otherHistory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel><DirtyLabel label="Otros antecedentes" dirty={dirtyFields.otherHistory} /></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Lo excepcional que no entra en la lista de antecedentes: medicación, hábitos..."
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
                <FormField
                  control={form.control}
                  name="physicalActivity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel><DirtyLabel label="Realiza actividad física" dirty={dirtyFields.physicalActivity} /></FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: Natación dos veces por semana..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <FormField
                  control={form.control}
                  name="painScale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel><DirtyLabel label="Escala EVA (cuando siente dolor)" dirty={dirtyFields.painScale} /></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          max="10"
                          step="1"
                          placeholder="0-10"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
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
              {correcting && <RevisionReasonField {...revision.fieldProps} />}
              {staleMessage && (
                <StaleRecordNotice message={staleMessage} reloading={false} onReload={() => void reload()} />
              )}
              <div className="flex justify-end pt-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="inline-flex">
                          <Button type="submit" disabled={mutation.isPending || !hasUnsavedChanges}>
                            {mutation.isPending ? 'Guardando...' : 'Guardar evaluación'}
                          </Button>
                        </span>
                      }
                    />
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
    </div>
  );
}

const ENCOUNTERS_PAGE_SIZE = 8;

function EncountersTab({
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
  const [selected, setSelected] = useState<Encounter | null>(null);
  // An annulled encounter opens its history: it is read, never edited.
  const [historyOf, setHistoryOf] = useState<Encounter | null>(null);
  const [page, setPage] = useState(0);

  const { data: encounters = [], isLoading } = useQuery({
    queryKey: encounterKeys.list(patientId, episodeId),
    queryFn: () => encounterApi.list(patientId, episodeId),
  });

  // To name the other problems a shared encounter treated.
  const { data: episodes = [] } = useQuery({
    queryKey: episodeKeys.list(patientId),
    queryFn: () => episodeApi.list(patientId),
  });
  const complaintOf = (id: string) =>
    episodes.find((ep) => ep.id === id)?.mainComplaint || 'Otro motivo';

  const reopenMutation = useMutation({
    mutationFn: () =>
      episodeApi.update(patientId, episodeId, {
        status: 'ACTIVE',
        closedAt: null,
        expectedVersion: episodes.find((ep) => ep.id === episodeId)?.version,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(patientId) });
      toast.success('Episodio reabierto');
      setClosedWarning(false);
      setNewOpen(true);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'No se pudo reabrir el episodio');
      if (isStaleEdit(err)) queryClient.invalidateQueries({ queryKey: episodeKeys.list(patientId) });
    },
  });

  // The record lists annulled encounters struck through (SPEC-clinical-revisions.md
  // §8); they count in nothing: not the total, the numbering or the discharge.
  const current = encounters.filter((s) => !s.annulledAt);
  const annulledCount = encounters.length - current.length;
  const dischargeEncounter = current.find((s) => s.encounterType === 'DISCHARGE') ?? null;
  const dischargeDate = dischargeEncounter
    ? new Date(dischargeEncounter.encounterDate).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  function handleNewEncounter() {
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
      <PainEvolutionChart encounters={encounters} episodeId={episodeId} />

      {/* Header de sección */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {current.length === 0
            ? 'Sin sesiones registradas'
            : `${current.length} ${current.length === 1 ? 'sesión' : 'sesiones'}`}
          {annulledCount > 0 && ` · ${annulledCount} anulada${annulledCount !== 1 ? 's' : ''}`}
        </p>
        <Button size="sm" onClick={handleNewEncounter}>
          <Plus className="h-4 w-4 mr-1" />
          Nueva sesión
        </Button>
      </div>

      {/* Advertencia: episodio cerrado */}
      <Dialog open={closedWarning} onOpenChange={setClosedWarning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Episodio cerrado</DialogTitle>
            <DialogDescription
              render={
              <div className="space-y-3 pt-1">
                <p>
                  {dischargeDate
                    ? <>Este paciente fue dado de alta el <span className="font-medium text-foreground">{dischargeDate}</span>.</>
                    : 'Este episodio está cerrado.'}
                </p>
                {dischargeEncounter && (
                  <button
                    type="button"
                    className="text-sm text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setClosedWarning(false);
                      setSelected(dischargeEncounter);
                    }}
                  >
                    Ver nota de alta
                  </button>
                )}
                <p>Para crear una nueva sesión, debes reabrir el episodio.</p>
                
              </div>
              }
            />
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
      {encounters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg">
          <p className="font-medium">Sin sesiones</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Registrá la primera sesión con el botón de arriba.
          </p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {encounters.slice(page * ENCOUNTERS_PAGE_SIZE, (page + 1) * ENCOUNTERS_PAGE_SIZE).map((encounter) => {
            const annulled = encounter.annulledAt !== null;
            const date = new Date(encounter.encounterDate);
            const formattedDate = date.toLocaleDateString('es-AR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            });
            // Numbered among the current ones; an annulled encounter has none.
            const encounterNumber = annulled ? null : current.length - current.indexOf(encounter);
            // This episode's block: the pain of a visit that treated several
            // problems is the pain of each one.
            const block = blockFor(encounter, episodeId);
            // An annulled encounter shows no clinical content in the list: it may
            // have been entered on the wrong patient. Its content is one click
            // away, in its history (review of #292).
            const hasPain =
              !annulled && !!block && (block.painScaleBefore !== null || block.painScaleAfter !== null);
            const otherEpisodes = annulled ? [] : encounter.episodes.filter((b) => b.episodeId !== episodeId);
            // This episode's treatment; a note shows its own text.
            const preview = annulled ? null : (block?.treatment ?? encounter.observations);

            return (
              <button
                key={encounter.id}
                type="button"
                className="w-full text-left"
                onClick={() => (annulled ? setHistoryOf(encounter) : setSelected(encounter))}
                aria-label={annulled ? `Sesión anulada del ${formattedDate}: ver historial` : undefined}
              >
                <Card className={`hover:bg-muted/40 transition-colors cursor-pointer ${annulled ? 'opacity-60' : ''}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Número de sesión */}
                        <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {encounterNumber ?? '–'}
                        </span>
                        <div className={`min-w-0 ${annulled ? 'line-through' : ''}`}>
                          <p className="text-sm font-medium capitalize">{formattedDate}</p>
                          {/* Preview del tratamiento */}
                          {preview && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                              {preview}
                            </p>
                          )}
                          {/* The same visit also treated other problems: it is
                              in their histories too, with their own block. */}
                          {otherEpisodes.length > 0 && (
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Link2 className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-xs">
                                También: {otherEpisodes.map((b) => complaintOf(b.episodeId)).join(', ')}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {/* Escalas de dolor */}
                        {hasPain && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {block?.painScaleBefore ?? '—'}
                            {' → '}
                            {block?.painScaleAfter ?? '—'}
                          </span>
                        )}
                        <EncounterTypeBadge type={encounter.encounterType} />
                        {annulled && <Badge variant="destructive">Anulada</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        {/* Pagination */}
        {encounters.length > ENCOUNTERS_PAGE_SIZE && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              {page * ENCOUNTERS_PAGE_SIZE + 1}–{Math.min((page + 1) * ENCOUNTERS_PAGE_SIZE, encounters.length)} de {encounters.length}
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
                {page + 1} / {Math.ceil(encounters.length / ENCOUNTERS_PAGE_SIZE)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * ENCOUNTERS_PAGE_SIZE >= encounters.length}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        </>
      )}

      <EncounterFormDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        patientId={patientId}
        episodeId={episodeId}
        onSuccess={() => setPage(0)}
      />

      {/* Ver una sesión registrada y editarla son la misma pantalla: se abre el
          mismo formulario que la creó, con los datos cargados. */}
      {selected && (
        <EncounterFormDialog
          open
          onOpenChange={(o) => !o && setSelected(null)}
          patientId={patientId}
          encounter={selected}
        />
      )}

      {historyOf && (
        <RevisionHistoryDialog
          open
          onOpenChange={(o) => !o && setHistoryOf(null)}
          patientId={patientId}
          base={revisionPaths.encounter(patientId, historyOf.id)}
          title="Historial de la sesión anulada"
          render={renderEncounterSnapshot}
          renderContext={{ episodeName: (id) => episodes.find((e) => e.id === id)?.mainComplaint ?? 'episodio' }}
        />
      )}
    </>
  );
}

const TAB_COMPONENT: Record<string, string> = {
  resumen: 'PatientDetailPage',
  evaluacion: 'EvaluationTab',
  sesiones: 'EncountersTab',
  actividad: 'ActivityTimeline',
};

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  // Whose history is open: the patient's data, or the selected episode's.
  const [history, setHistory] = useState<'patient' | 'episode' | null>(null);
  const [activeTab, setActiveTab] = useState('resumen');
  const [evalHasChanges, setEvalHasChanges] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false);
  const [newEpisodeComplaint, setNewEpisodeComplaint] = useState('');
  const [editEpisodeOpen, setEditEpisodeOpen] = useState(false);
  const [editEpisodeComplaint, setEditEpisodeComplaint] = useState('');
  // The version the complaint on screen was read from, kept with it: a refetch
  // while the dialog is open (on window focus, say) must not save that text over
  // a newer version without a 409.
  const [editEpisodeVersion, setEditEpisodeVersion] = useState(0);
  // Correcting the complaint says why; closing and reopening do not.
  const episodeRevision = useRevisionReason();
  const [episodeStale, setEpisodeStale] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  // El alta es una sesión más (encounterType DISCHARGE): la API la registra y
  // cierra el episodio en la misma transacción. Por eso se abre el mismo modal
  // de sesión, no un formulario aparte.
  const [dischargeOpen, setDischargeOpen] = useState(false);

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

  // Unsaved evaluation text belongs to the episode on screen: whatever would
  // change the episode, the tab or the page asks first (the evaluation form is
  // keyed by episode, so a switch discards it).
  function guardEval(action: () => void) {
    if (evalHasChanges && activeTab === 'evaluacion') {
      setPendingAction(() => action);
    } else {
      action();
    }
  }

  // Once there is unsaved text, the episode it was typed for is pinned: a
  // refetch that changes the first active episode must not swap the form.
  function handleEvalDirty(dirty: boolean) {
    setEvalHasChanges(dirty);
    if (dirty) setActiveEpisodeId((current) => current ?? effectiveEpisodeId);
  }

  const createEpisodeMutation = useMutation({
    mutationFn: (complaint: string) =>
      episodeApi.create(id!, { mainComplaint: complaint }),
    onSuccess: (newEpisode) => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(id!) });
      setActiveEpisodeId(newEpisode.id);
      setNewEpisodeOpen(false);
      setNewEpisodeComplaint('');
    },
  });

  const editedEpisode = episodes.find((e) => e.id === effectiveEpisodeId);
  // Each write carries the version it was decided on; a 409 shows the message
  // and offers a reload.
  const updateEpisodeMutation = useMutation({
    mutationFn: (data: EpisodeUpdateData) => episodeApi.update(id!, effectiveEpisodeId!, data),
    onError: (err: Error) => {
      if (isStaleEdit(err)) {
        setEpisodeStale(err.message);
        return;
      }
      toast.error(err.message || 'No se pudo guardar el episodio');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(id!) });
      setEditEpisodeOpen(false);
      setEpisodeStale(null);
      episodeRevision.reset();
      setConfirmAbandon(false);
    },
  });
  // Over the version the text was read from, not the list's latest. Reopening
  // goes over the list's latest: it acts on the status on screen, which is live.
  const saveEpisodeComplaint = () => {
    const reason = episodeRevision.require();
    if (!reason) return;
    updateEpisodeMutation.mutate({
      mainComplaint: editEpisodeComplaint,
      reason,
      reasonNote: episodeRevision.note,
      expectedVersion: editEpisodeVersion,
    });
  };

  useEffect(() => { document.title = TAB_COMPONENT[activeTab] ?? 'PatientDetailPage'; }, [activeTab]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando...</div>;
  }

  if (isError || !patient) {
    return <div className="p-6 text-sm text-destructive">Paciente no encontrado.</div>;
  }

  const age = getAge(patient.birthDate);
  const birthFormatted = formatDay(patient.birthDate) ?? undefined;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Volver */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 mb-4 text-muted-foreground"
        onClick={() => guardEval(() => navigate('/patients'))}
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
              {/* El <span> es necesario: un button deshabilitado no dispara
                  los eventos de mouse que el Tooltip necesita para mostrarse */}
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button variant="outline" disabled>
                      <FileText className="h-4 w-4 mr-2" />
                      Descargar informe
                    </Button>
                  </span>
                }
              />
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
            onSelect={(episodeId) => {
              if (episodeId !== effectiveEpisodeId) guardEval(() => setActiveEpisodeId(episodeId));
            }}
            onNewEpisode={() => guardEval(() => setNewEpisodeOpen(true))}
          />
          {effectiveEpisodeId && (
            <button
              type="button"
              title="Editar motivo del episodio"
              onClick={() => {
                const ep = episodes.find((e) => e.id === effectiveEpisodeId);
                // The selection is pinned, so a refetch cannot move the dialog
                // to another episode.
                setActiveEpisodeId(effectiveEpisodeId);
                setEditEpisodeComplaint(ep?.mainComplaint ?? '');
                setEditEpisodeVersion(ep?.version ?? 0);
                episodeRevision.reset();
                setConfirmAbandon(false);
                setEditEpisodeOpen(true);
              }}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {effectiveEpisodeId && <RevisionHistoryButton onClick={() => setHistory('episode')} />}
          {effectiveEpisodeId && episodes.find((e) => e.id === effectiveEpisodeId)?.status !== 'ACTIVE' && (
            <span className="text-xs text-muted-foreground">
              Episodio cerrado.{' '}
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => guardEval(() => setNewEpisodeOpen(true))}
              >
                ¿Nueva consulta?
              </button>
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(tab) => guardEval(() => setActiveTab(tab))}>
        <TabsList variant="line">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="evaluacion">Evaluación inicial</TabsTrigger>
          <TabsTrigger value="sesiones">Sesiones</TabsTrigger>
          {/* The informed consent is hidden until a consent records the text
              the patient signed (#248): today the row holds only dates, and the
              text lives in ConsentTab. The component, the API and the model
              stay; a consent already signed still shows in Actividad. */}
          <TabsTrigger value="actividad">Actividad</TabsTrigger>
        </TabsList>
        <Separator />

        {/* ── Resumen ── */}
        <TabsContent value="resumen" className="mt-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Datos personales</CardTitle>
                <RevisionHistoryButton onClick={() => setHistory('patient')} />
              </div>
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
                <DetailField
                  label="Documento"
                  value={
                    patient.documentType && patient.documentNumber
                      ? `${DOCUMENT_TYPE_LABELS[patient.documentType]} ${patient.documentNumber}`
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
              // A new form per episode: one with no evaluation yet must not
              // keep the previous episode's fields (they would be saved on it).
              key={effectiveEpisodeId}
              patientId={id!}
              episodeId={effectiveEpisodeId}
              occupation={patient.occupation}
              patientVersion={patient.version}
              onUnsavedChangesChange={handleEvalDirty}
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
            <EncountersTab
              key={effectiveEpisodeId}
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
      <Dialog open={editEpisodeOpen} onOpenChange={(o) => { setEditEpisodeOpen(o); setConfirmAbandon(false); setEpisodeStale(null); }}>
        <DialogContent>
          {confirmAbandon ? (
            <AbandonEpisodeConfirm
              patientId={id!}
              episodeId={effectiveEpisodeId!}
              episodeVersion={editedEpisode?.version ?? 0}
              onCancel={() => setConfirmAbandon(false)}
              onAbandoned={() => {
                queryClient.invalidateQueries({ queryKey: episodeKeys.list(id!) });
                setEditEpisodeOpen(false);
                setConfirmAbandon(false);
              }}
            />
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
                    if (e.key === 'Enter') saveEpisodeComplaint();
                  }}
                  autoFocus
                />
              </div>
              <RevisionReasonField {...episodeRevision.fieldProps} />
              {episodeStale && (
                <StaleRecordNotice
                  message={episodeStale}
                  reloading={false}
                  onReload={() => {
                    void queryClient
                      .fetchQuery({ queryKey: episodeKeys.list(id!), queryFn: () => episodeApi.list(id!), staleTime: 0 })
                      .then((fresh) => {
                        const ep = fresh.find((e) => e.id === effectiveEpisodeId);
                        setEditEpisodeComplaint(ep?.mainComplaint ?? '');
                        setEditEpisodeVersion(ep?.version ?? 0);
                        setEpisodeStale(null);
                      });
                  }}
                />
              )}
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {episodes.find((e) => e.id === effectiveEpisodeId)?.status === 'ACTIVE' ? (
                    <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            className="text-xs"
                            onClick={() => {
                              setEditEpisodeOpen(false);
                              setDischargeOpen(true);
                            }}
                          >
                            Registrar alta
                          </Button>
                        }
                      />
                      <TooltipContent>
                        <p>Registra la sesión de cierre y da de alta el episodio en un solo paso.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button variant="ghost" className="text-xs" onClick={() => setConfirmAbandon(true)}>
                            Registrar abandono
                          </Button>
                        }
                      />
                      <TooltipContent>
                        <p>Elegí esta opción si el paciente deja de asistir sin alta formal. Podés reactivarlo si regresa.</p>
                      </TooltipContent>
                    </Tooltip>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={() =>
                        updateEpisodeMutation.mutate({ status: 'ACTIVE', closedAt: null, expectedVersion: editedEpisode?.version })
                      }
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
                    onClick={saveEpisodeComplaint}
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

      {effectiveEpisodeId && (
        <EncounterFormDialog
          open={dischargeOpen}
          onOpenChange={setDischargeOpen}
          patientId={id!}
          episodeId={effectiveEpisodeId}
          encounterType="DISCHARGE"
        />
      )}

      <RevisionHistoryDialog
        open={history === 'patient'}
        onOpenChange={(o) => !o && setHistory(null)}
        patientId={id!}
        base={revisionPaths.patient(id!)}
        title="Historial de los datos del paciente"
        render={renderPatientSnapshot}
      />
      {effectiveEpisodeId && (
        <RevisionHistoryDialog
          open={history === 'episode'}
          onOpenChange={(o) => !o && setHistory(null)}
          patientId={id!}
          base={revisionPaths.episode(id!, effectiveEpisodeId)}
          title="Historial del episodio"
          render={renderEpisodeSnapshot}
        />
      )}

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
