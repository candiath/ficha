import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { packageApi, packageKeys, paymentApi, paymentKeys } from '@/services/payments';
import { sessionApi, sessionKeys } from '@/services/sessions';
import { sessionTechniqueApi, sessionTechniqueKeys } from '@/services/sessionTechniques';
import { SESSION_TYPE_LABELS } from '@/lib/labels';
import { toast } from 'sonner';
import SessionTechniquesPicker from '@/components/sessions/SessionTechniquesPicker';
import type { TechniqueEntry } from '@/components/sessions/SessionTechniquesPicker';
import type { Session } from '@/types/session';

const schema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  sessionDate: z.string().min(1, 'La fecha es requerida'),
  // Strings en el form; se convierten a número en mutationFn.
  painScaleBefore: z.string(),
  painScaleAfter: z.string(),
  preSesionState: z.string().optional().or(z.literal('')),
  reEvaluationNotes: z.string().optional().or(z.literal('')),
  patientResponse: z.string().optional().or(z.literal('')),
  observations: z.string().optional().or(z.literal('')),
  // Pago (solo requerido al crear; en edición la sección no se muestra)
  baseAmount: z.string().optional().or(z.literal('')),
  discount: z.string().optional().or(z.literal('')),
  packageId: z.string().optional().or(z.literal('')),
  paymentNotes: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  patientId: string;
  episodeId?: string;
  session?: Session;
}

export default function SessionFormDialog({ open, onClose, patientId, episodeId, session }: Props) {
  const queryClient = useQueryClient();
  const isEditing = !!session;
  const [techniqueEntries, setTechniqueEntries] = useState<TechniqueEntry[]>([]);

  // Cargar técnicas existentes al editar
  const { data: existingTechniques } = useQuery({
    queryKey: sessionTechniqueKeys.list(patientId, session?.id ?? ''),
    queryFn: () => sessionTechniqueApi.list(patientId, session!.id),
    enabled: isEditing && !!session?.id,
  });

  useEffect(() => {
    if (isEditing && existingTechniques) {
      setTechniqueEntries(
        existingTechniques.map((t) => ({
          id: t.id,
          techniqueId: t.techniqueId,
          techniqueName: t.techniqueName,
          bodyRegionId: t.bodyRegionId ?? '',
          bodyRegionName: t.bodyRegionName ?? '',
          muscularChainId: t.muscularChainId ?? '',
          muscularChainName: t.muscularChainName ?? '',
          variantNotes: t.variantNotes ?? '',
        })),
      );
    }
  }, [isEditing, existingTechniques]);

  // Último precio base para pre-llenar (solo en modo creación)
  const { data: lastPriceData } = useQuery({
    queryKey: paymentKeys.lastBasePrice,
    queryFn: paymentApi.lastBasePrice,
    enabled: !isEditing,
  });

  // Paquetes activos del paciente
  const { data: packages = [] } = useQuery({
    queryKey: packageKeys.byPatient(patientId),
    queryFn: () => packageApi.list(patientId),
  });

  const activePackages = useMemo(
    () => packages.filter((pkg) => pkg.remainingSessions > 0),
    [packages],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sessionType: 'SESSION',
      sessionDate: new Date().toISOString().slice(0, 16),
      painScaleBefore: '',
      painScaleAfter: '',
      preSesionState: '',
      reEvaluationNotes: '',
      patientResponse: '',
      observations: '',
      baseAmount: '',
      discount: '',
      packageId: '',
      paymentNotes: '',
    },
  });

  // Reinicializa al abrir / cambiar sesión
  useEffect(() => {
    if (!open) return;
    if (isEditing) {
      form.reset({
        sessionType: session.sessionType ?? 'SESSION',
        sessionDate: session.sessionDate
          ? new Date(session.sessionDate).toISOString().slice(0, 16)
          : new Date().toISOString().slice(0, 16),
        painScaleBefore: session.painScaleBefore?.toString() ?? '',
        painScaleAfter: session.painScaleAfter?.toString() ?? '',
        preSesionState: session.preSesionState ?? '',
        reEvaluationNotes: session.reEvaluationNotes ?? '',
        patientResponse: session.patientResponse ?? '',
        observations: session.observations ?? '',
        baseAmount: '',
        discount: '',
        packageId: '',
        paymentNotes: '',
      });
    } else {
      form.reset({
        sessionType: 'SESSION',
        sessionDate: new Date().toISOString().slice(0, 16),
        painScaleBefore: '',
        painScaleAfter: '',
        preSesionState: '',
        reEvaluationNotes: '',
        patientResponse: '',
        observations: '',
        baseAmount: lastPriceData?.amount != null ? String(lastPriceData.amount) : '',
        discount: '',
        packageId: '',
        paymentNotes: '',
      });
      setTechniqueEntries([]);
    }
  }, [open, session, lastPriceData]);

  // Cuando se selecciona un paquete, pre-llenar el precio del paquete
  const selectedPackageId = form.watch('packageId');
  useEffect(() => {
    if (!selectedPackageId) return;
    const pkg = activePackages.find((p) => p.id === selectedPackageId);
    if (pkg) form.setValue('baseAmount', String(pkg.pricePerSession));
  }, [selectedPackageId, activePackages, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const toScale = (v: string) => (v === '' ? null : parseInt(v, 10));
      const sessionData = {
        sessionType: values.sessionType,
        sessionDate: new Date(values.sessionDate).toISOString(),
        painScaleBefore: toScale(values.painScaleBefore),
        painScaleAfter: toScale(values.painScaleAfter),
        preSesionState: values.preSesionState || null,
        reEvaluationNotes: values.reEvaluationNotes || null,
        patientResponse: values.patientResponse || null,
        observations: values.observations || null,
      };

      if (isEditing) {
        const updated = await sessionApi.update(patientId, session.id, sessionData);
        // Guardar técnicas en edición también
        if (techniqueEntries.length > 0 || existingTechniques?.length) {
          await sessionTechniqueApi.bulkReplace(
            patientId,
            session.id,
            techniqueEntries.map((e) => ({
              techniqueId: e.techniqueId,
              bodyRegionId: e.bodyRegionId || null,
              muscularChainId: e.muscularChainId || null,
              variantNotes: e.variantNotes || null,
            })),
          );
        }
        return updated;
      }

      // Crear sesión y luego el pago y técnicas
      const newSession = await sessionApi.create(patientId, { ...sessionData, episodeId: episodeId ?? null });
      await paymentApi.create({
        patientId,
        sessionId: newSession.id,
        packageId: values.packageId || null,
        baseAmount: parseFloat(values.baseAmount ?? '0'),
        discount: values.discount ? parseFloat(values.discount) : 0,
        notes: values.paymentNotes || null,
      });
      if (techniqueEntries.length > 0) {
        await sessionTechniqueApi.bulkReplace(
          patientId,
          newSession.id,
          techniqueEntries.map((e) => ({
            techniqueId: e.techniqueId,
            bodyRegionId: e.bodyRegionId || null,
            muscularChainId: e.muscularChainId || null,
            variantNotes: e.variantNotes || null,
          })),
        );
      }
      return newSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success(isEditing ? 'Sesión actualizada' : 'Sesión registrada');
      onClose();
      form.reset();
    },
    onError: () => {
      toast.error('Error al guardar la sesión');
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[95vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>{isEditing ? 'Editar sesión' : 'Nueva sesión'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => {
                if (!isEditing && !v.baseAmount?.trim()) {
                  form.setError('baseAmount', { message: 'El monto base es requerido' });
                  return;
                }
                mutation.mutate(v);
              })}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Fila: fecha + tipo */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sessionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha y hora</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sessionType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue>
                            {field.value ? SESSION_TYPE_LABELS[field.value] : 'Seleccionar'}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(SESSION_TYPE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Escalas de dolor */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="painScaleBefore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dolor antes (0–10)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        placeholder="—"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="painScaleAfter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dolor después (0–10)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        placeholder="—"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="preSesionState"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estado pre-sesión</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="¿Cómo llegó el paciente? ¿Cambios desde la última sesión?"
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
              name="reEvaluationNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Re-evaluación</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Cambios posturales, rangos articulares, hallazgos..."
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
              name="patientResponse"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Respuesta del paciente</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="¿Cómo respondió a las posturas trabajadas?"
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
              name="observations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observaciones / técnicas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Técnicas utilizadas, tiempos, zonas trabajadas..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Técnicas aplicadas ── */}
            <Separator />
            <SessionTechniquesPicker
              value={techniqueEntries}
              onChange={setTechniqueEntries}
            />

            {/* ── Sección de pago (solo en creación) ── */}
            {!isEditing && (
              <>
                <Separator />
                <p className="text-sm font-medium">Cobro de sesión</p>

                {activePackages.length > 0 && (
                  <FormField
                    control={form.control}
                    name="packageId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Paquete</FormLabel>
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sin paquete (precio individual)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="">Sin paquete</SelectItem>
                            {activePackages.map((pkg) => (
                              <SelectItem key={pkg.id} value={pkg.id}>
                                {pkg.name} — {pkg.remainingSessions} sesión
                                {pkg.remainingSessions !== 1 ? 'es' : ''} restante
                                {pkg.remainingSessions !== 1 ? 's' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="baseAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Monto base *
                          {lastPriceData?.isStale === false && (
                            <span className="text-muted-foreground font-normal ml-1 text-xs">
                              (último precio)
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input type="number" min={0} step={0.01} placeholder="0.00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descuento</FormLabel>
                        <FormControl>
                          <Input type="number" min={0} step={0.01} placeholder="0.00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="paymentNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notas de pago</FormLabel>
                      <FormControl>
                        <Input placeholder="Ej: pagó mitad hoy, resto próxima semana" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {mutation.isError && (
              <p className="text-destructive text-sm">
                {(mutation.error as Error)?.message ?? 'Error al guardar'}
              </p>
            )}

            </div>{/* end scrollable area */}

            <div className="shrink-0 border-t px-6 py-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar sesión'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
