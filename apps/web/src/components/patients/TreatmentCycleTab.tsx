import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, CheckCircle2, PauseCircle, PlayCircle } from 'lucide-react';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { muscularChainApi, muscularChainKeys } from '@/services/muscularChains';
import { treatmentCycleApi, treatmentCycleKeys } from '@/services/treatmentCycles';
import { sessionApi, sessionKeys } from '@/services/sessions';
import type { TreatmentCycle } from '@/types/treatmentCycle';

const CYCLE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  COMPLETED: 'Completado',
  PAUSED: 'Pausado',
};

const CYCLE_STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  COMPLETED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  PAUSED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
};

const formSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  mainChainId: z.string().optional().or(z.literal('')),
  objective: z.string().optional().or(z.literal('')),
  targetSessions: z.string().optional().or(z.literal('')),
  reevalEvery: z.string().optional().or(z.literal('')),
  dischargeCriteria: z.string().optional().or(z.literal('')),
  startedAt: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  patientId: string;
  episodeId: string;
}

export default function TreatmentCycleTab({ patientId, episodeId }: Props) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TreatmentCycle | null>(null);

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: treatmentCycleKeys.list(patientId, episodeId),
    queryFn: () => treatmentCycleApi.list(patientId, episodeId),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: sessionKeys.list(patientId),
    queryFn: () => sessionApi.list(patientId),
  });

  const { data: chains = [] } = useQuery({
    queryKey: muscularChainKeys.all,
    queryFn: muscularChainApi.list,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      mainChainId: '',
      objective: '',
      targetSessions: '',
      reevalEvery: '',
      dischargeCriteria: '',
      startedAt: new Date().toISOString().slice(0, 10),
    },
  });

  function openCreate() {
    setEditing(null);
    form.reset({
      name: '',
      mainChainId: '',
      objective: '',
      targetSessions: '',
      reevalEvery: '',
      dischargeCriteria: '',
      startedAt: new Date().toISOString().slice(0, 10),
    });
    setDialogOpen(true);
  }

  function openEdit(cycle: TreatmentCycle) {
    setEditing(cycle);
    form.reset({
      name: cycle.name,
      mainChainId: cycle.mainChainId ?? '',
      objective: cycle.objective ?? '',
      targetSessions: cycle.targetSessions?.toString() ?? '',
      reevalEvery: cycle.reevalEvery?.toString() ?? '',
      dischargeCriteria: cycle.dischargeCriteria ?? '',
      startedAt: cycle.startedAt.slice(0, 10),
    });
    setDialogOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const data = {
        name: values.name,
        mainChainId: values.mainChainId || null,
        objective: values.objective || null,
        targetSessions: values.targetSessions ? parseInt(values.targetSessions, 10) : null,
        reevalEvery: values.reevalEvery ? parseInt(values.reevalEvery, 10) : null,
        dischargeCriteria: values.dischargeCriteria || null,
        startedAt: values.startedAt
          ? new Date(values.startedAt + 'T00:00:00.000Z').toISOString()
          : undefined,
      };
      return editing
        ? treatmentCycleApi.update(patientId, episodeId, editing.id, data)
        : treatmentCycleApi.create(patientId, episodeId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: treatmentCycleKeys.list(patientId, episodeId) });
      toast.success(editing ? 'Ciclo actualizado' : 'Ciclo creado');
      setDialogOpen(false);
    },
    onError: () => toast.error('Error al guardar el ciclo'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ cycleId, status }: { cycleId: string; status: 'ACTIVE' | 'COMPLETED' | 'PAUSED' }) =>
      treatmentCycleApi.update(patientId, episodeId, cycleId, {
        status,
        completedAt: status === 'COMPLETED' ? new Date().toISOString() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: treatmentCycleKeys.list(patientId, episodeId) });
    },
    onError: () => toast.error('Error al actualizar el estado'),
  });

  const deleteMutation = useMutation({
    mutationFn: (cycleId: string) => treatmentCycleApi.delete(patientId, episodeId, cycleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: treatmentCycleKeys.list(patientId, episodeId) });
      toast.success('Ciclo eliminado');
    },
    onError: () => toast.error('Error al eliminar el ciclo'),
  });

  if (isLoading) {
    return <div className="py-8 text-sm text-muted-foreground">Cargando...</div>;
  }

  // Contar sesiones por rango de fechas del ciclo activo (aproximación)
  function getSessionCount(cycle: TreatmentCycle) {
    const start = new Date(cycle.startedAt);
    const end = cycle.completedAt ? new Date(cycle.completedAt) : new Date();
    return sessions.filter((s) => {
      const d = new Date(s.sessionDate);
      return d >= start && d <= end;
    }).length;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {cycles.length === 0
            ? 'Sin ciclos registrados'
            : `${cycles.length} ciclo${cycles.length !== 1 ? 's' : ''}`}
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Nuevo ciclo
        </Button>
      </div>

      {cycles.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg">
          Todavía no hay ciclos. Creá el primero para organizar el plan terapéutico.
        </div>
      ) : (
        <div className="space-y-4">
          {cycles.map((cycle) => {
            const sessionCount = getSessionCount(cycle);
            const progress =
              cycle.targetSessions && cycle.targetSessions > 0
                ? Math.min(100, Math.round((sessionCount / cycle.targetSessions) * 100))
                : null;

            return (
              <Card key={cycle.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{cycle.name}</span>
                        <Badge
                          variant="outline"
                          className={CYCLE_STATUS_CLASS[cycle.status]}
                        >
                          {CYCLE_STATUS_LABELS[cycle.status]}
                        </Badge>
                        {cycle.mainChainName && (
                          <Badge variant="secondary" className="text-xs">
                            {cycle.mainChainName}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Iniciado:{' '}
                        {new Date(cycle.startedAt).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })}
                        {cycle.completedAt && (
                          <>
                            {' '}· Completado:{' '}
                            {new Date(cycle.completedAt).toLocaleDateString('es-AR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {cycle.status === 'ACTIVE' && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-yellow-600"
                            title="Pausar ciclo"
                            onClick={() =>
                              statusMutation.mutate({ cycleId: cycle.id, status: 'PAUSED' })
                            }
                          >
                            <PauseCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-blue-600"
                            title="Marcar como completado"
                            onClick={() =>
                              statusMutation.mutate({ cycleId: cycle.id, status: 'COMPLETED' })
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {cycle.status === 'PAUSED' && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-green-600"
                          title="Reactivar ciclo"
                          onClick={() =>
                            statusMutation.mutate({ cycleId: cycle.id, status: 'ACTIVE' })
                          }
                        >
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => openEdit(cycle)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutate(cycle.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {cycle.objective && (
                    <p className="text-sm text-muted-foreground">{cycle.objective}</p>
                  )}

                  {/* Progreso de sesiones */}
                  {cycle.targetSessions && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Sesiones</span>
                        <span>
                          {sessionCount} / {cycle.targetSessions}
                        </span>
                      </div>
                      <Progress value={progress ?? 0} className="h-2" />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    {cycle.reevalEvery && (
                      <span>Reevaluar cada {cycle.reevalEvery} sesiones</span>
                    )}
                    {cycle.dischargeCriteria && (
                      <span>Alta: {cycle.dischargeCriteria}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar ciclo' : 'Nuevo ciclo'}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre del ciclo *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ciclo 1 — Lumbalgia" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="mainChainId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cadena muscular principal</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Opcional" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {chains.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="startedAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha de inicio</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="objective"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Objetivo clínico</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Reducir dolor lumbar, mejorar movilidad..."
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="targetSessions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sesiones planificadas</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="10" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="reevalEvery"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reevaluar cada N sesiones</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="5" min="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="dischargeCriteria"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Criterio de alta</FormLabel>
                    <FormControl>
                      <Input placeholder="Sin dolor, amplitud completa..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Guardando...' : 'Guardar'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
