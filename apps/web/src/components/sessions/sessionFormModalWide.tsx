import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBeforeUnload } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { Calendar, CreditCard, FileText, ListChecks } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { packageApi, packageKeys, paymentApi, paymentKeys } from '@/services/payments'
import { sessionApi } from '@/services/sessions'
import { episodeApi, episodeKeys } from '@/services/episodes'
import { globalSessionKeys } from '@/services/globalSessions'
import {
  getSessionDateWarnings,
  useSessionDateTolerances,
} from '@/lib/sessionDateTolerances'
import { toLocalDateTimeInput } from '@/lib/utils'
import type { Session, SessionType } from '@/types/session'

const schema = z.object({
  sessionDate: z
    .string()
    .min(1, 'La fecha es requerida')
    .superRefine((value, ctx) => {
      // Sólo error DURO: la fecha debe ser parseable. Lo demás (futuro,
      // pasado lejano) son advertencias blandas -> ver getSessionDateWarnings.
      if (Number.isNaN(new Date(value).getTime())) {
        ctx.addIssue({ code: 'custom', message: 'La fecha no es válida' })
      }
    }),
  painScaleBefore: z.number().min(0).max(10).nullable(),
  painScaleAfter: z.number().min(0).max(10).nullable(),
  preSesionState: z.string().optional().or(z.literal('')),
  reEvaluationNotes: z.string().optional().or(z.literal('')),
  patientResponse: z.string().optional().or(z.literal('')),
  observations: z.string().optional().or(z.literal('')),
  baseAmount: z.string().optional().or(z.literal('')),
  discount: z.string().optional().or(z.literal('')),
  packageId: z.string().optional().or(z.literal('')),
  paymentNotes: z.string().optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

interface SessionFormModalWideProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  episodeId?: string
  session?: Session
  /** Tipo de la sesión a crear. No se elige en el modal: lo fija quien lo abre
   *  ('DISCHARGE' desde "Registrar alta"). Al editar se ignora: el PATCH no
   *  manda sessionType, así una sesión conserva el tipo con el que nació. */
  sessionType?: SessionType
  /** Se invoca tras guardar con éxito. Útil, p. ej., para resetear la paginación
   *  cuando se crea una sesión nueva (queda en la página 1). */
  onSuccess?: () => void
}

function getPainColor(value: number | null) {
  if (value === null) return 'text-muted-foreground'
  if (value <= 3) return 'text-emerald-600'
  if (value <= 6) return 'text-amber-600'
  return 'text-red-600'
}

export default function SessionFormModalWide({
  open,
  onOpenChange,
  patientId,
  episodeId,
  session,
  sessionType = 'SESSION',
  onSuccess,
}: SessionFormModalWideProps) {
  const queryClient = useQueryClient()
  const isEditing = !!session
  const dateTolerances = useSessionDateTolerances()
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const { data: episodes = [] } = useQuery({
    queryKey: episodeKeys.list(patientId),
    queryFn: () => episodeApi.list(patientId),
  })

  // El motivo no se elige: una sesión aborda un único episodio, y cuál es ya
  // quedó decidido antes de abrir el modal. Al crear viene del episodio en el
  // que está parado el usuario; al editar, del que la sesión ya tiene.
  //
  // El M:N sigue existiendo en la base (hay sesiones viejas con varios
  // motivos), así que al editar una de ésas nos quedamos con el primero y el
  // guardado desvincula el resto.
  const effectiveEpisodeId = (isEditing ? session?.episodeIds[0] : episodeId) ?? ''
  const effectiveEpisode = episodes.find((ep) => ep.id === effectiveEpisodeId)

  const { data: lastPriceData } = useQuery({
    queryKey: paymentKeys.lastBasePrice,
    queryFn: paymentApi.lastBasePrice,
    enabled: !isEditing,
  })

  const { data: packages = [] } = useQuery({
    queryKey: packageKeys.byPatient(patientId),
    queryFn: () => packageApi.list(patientId),
  })

  const activePackages = useMemo(
    () => packages.filter((pkg) => pkg.remainingSessions > 0),
    [packages],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sessionDate: toLocalDateTimeInput(new Date()),
      painScaleBefore: null,
      painScaleAfter: null,
      preSesionState: '',
      reEvaluationNotes: '',
      patientResponse: '',
      observations: '',
      baseAmount: '',
      discount: '',
      packageId: '',
      paymentNotes: '',
    },
  })

  useEffect(() => {
    if (!open) return
    if (isEditing) {
      form.reset({
        sessionDate: session.sessionDate
          ? toLocalDateTimeInput(new Date(session.sessionDate))
          : toLocalDateTimeInput(new Date()),
        painScaleBefore: session.painScaleBefore ?? null,
        painScaleAfter: session.painScaleAfter ?? null,
        preSesionState: session.preSesionState ?? '',
        reEvaluationNotes: session.reEvaluationNotes ?? '',
        patientResponse: session.patientResponse ?? '',
        observations: session.observations ?? '',
        baseAmount: '',
        discount: '',
        packageId: '',
        paymentNotes: '',
      })
    } else {
      form.reset({
          sessionDate: toLocalDateTimeInput(new Date()),
        painScaleBefore: null,
        painScaleAfter: null,
        preSesionState: '',
        reEvaluationNotes: '',
        patientResponse: '',
        observations: '',
        baseAmount: '',
        discount: '',
        packageId: '',
        paymentNotes: '',
      })
    }
  }, [open, session, episodeId, isEditing, form])

  // El último precio llega de una query async y puede resolver DESPUÉS de abrir el
  // modal. Lo aplicamos cuando llega, pero solo si el usuario todavía no tocó el
  // campo, para no pisar lo que haya escrito. (Antes esto vivía en el reset de
  // arriba, lo que descartaba toda edición previa al cargar el precio.)
  useEffect(() => {
    if (!open || isEditing) return
    if (lastPriceData?.amount == null) return
    if (form.getFieldState('baseAmount').isDirty) return
    form.setValue('baseAmount', String(lastPriceData.amount))
  }, [open, isEditing, lastPriceData, form])

  const selectedPackageId = form.watch('packageId')
  useEffect(() => {
    if (!selectedPackageId) return
    const pkg = activePackages.find((p) => p.id === selectedPackageId)
    if (pkg) form.setValue('baseAmount', String(pkg.pricePerSession))
  }, [selectedPackageId, activePackages, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const sessionData = {
        sessionDate: new Date(values.sessionDate).toISOString(),
        painScaleBefore: values.painScaleBefore,
        painScaleAfter: values.painScaleAfter,
        preSesionState: values.preSesionState || null,
        reEvaluationNotes: values.reEvaluationNotes || null,
        patientResponse: values.patientResponse || null,
        observations: values.observations || null,
      }

      // El motivo viaja siempre como un arreglo de a lo sumo uno: es lo que
      // espera la API (el pivote sigue siendo M:N) y, al editar una sesión
      // vieja con varios, desvincula los que sobran.
      const episodeIds = effectiveEpisodeId ? [effectiveEpisodeId] : []

      // El PATCH no lleva sessionType: el schema de la API es partial, así que
      // omitirlo deja intacto el tipo con el que se registró la sesión (una
      // nota rápida o un alta no se convierten en sesión común al editarlas).
      if (isEditing) {
        return sessionApi.update(patientId, session.id, { ...sessionData, episodeIds })
      }

      // Un solo request: la API crea sesión + pago en una transacción, así un
      // fallo de red o validación no deja una sesión sin pago (invisible en
      // Cobros) ni duplicados al reintentar.
      return sessionApi.create(patientId, {
        ...sessionData,
        sessionType,
        episodeIds,
        payment: {
          packageId: values.packageId || null,
          baseAmount: parseFloat(values.baseAmount ?? '0'),
          discount: values.discount ? parseFloat(values.discount) : 0,
          notes: values.paymentNotes || null,
        },
      })
    },
    onSuccess: () => {
      // La sesión puede estar vinculada a varios episodios: invalidamos toda lista
      // de sesiones del paciente (con o sin episodio en la key), no solo una.
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === 'patients' &&
          q.queryKey[1] === patientId &&
          q.queryKey.includes('sessions'),
      })
      queryClient.invalidateQueries({ queryKey: episodeKeys.list(patientId) })
      queryClient.invalidateQueries({ queryKey: globalSessionKeys.all })
      queryClient.invalidateQueries({ queryKey: paymentKeys.all })
      toast.success(isEditing ? 'Sesión actualizada' : 'Sesión registrada')
      onOpenChange(false)
      form.reset()
      onSuccess?.()
    },
    onError: () => {
      toast.error('Error al guardar la sesión')
    },
  })

  const painBefore = form.watch('painScaleBefore')
  const painAfter = form.watch('painScaleAfter')

  const hasUnsavedChanges = form.formState.isDirty

  // Advertir al cerrar/recargar el navegador con cambios sin guardar (igual que la
  // evaluación inicial). El interceptor de abajo solo cubre el cierre del modal.
  useBeforeUnload(
    useCallback((e) => {
      if (open && hasUnsavedChanges) e.preventDefault()
    }, [open, hasUnsavedChanges]),
  )

  // Interceptamos el cierre del modal (Escape, click fuera, botón X o "Cancelar"):
  // si hay cambios sin guardar, pedimos confirmación antes de descartar.
  function handleOpenChange(next: boolean) {
    if (!next && hasUnsavedChanges) {
      setShowDiscardConfirm(true)
      return
    }
    onOpenChange(next)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-[95vw] lg:max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b bg-muted/30">
          <DialogTitle className="text-xl">
            {isEditing
              ? 'Editar sesión'
              : sessionType === 'DISCHARGE'
                ? 'Registrar alta'
                : 'Nueva sesión'}
          </DialogTitle>
          {!isEditing && sessionType === 'DISCHARGE' && (
            <DialogDescription>
              Al guardar, el motivo queda cerrado con fecha de alta.
            </DialogDescription>
          )}
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => {
              if (!isEditing && !v.baseAmount?.trim()) {
                form.setError('baseAmount', { message: 'El monto base es requerido' })
                return
              }
              mutation.mutate(v)
            })}
            className="p-4 sm:p-6"
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Columna izquierda */}
              <div className="space-y-6">
                {/* Información básica */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      Información de la sesión
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="sessionDate"
                        render={({ field }) => {
                          const dateWarnings = getSessionDateWarnings(
                            field.value,
                            dateTolerances,
                          )
                          return (
                            <FormItem>
                              <FormLabel>Fecha y hora</FormLabel>
                              <FormControl>
                                <Input type="datetime-local" {...field} />
                              </FormControl>
                              <FormMessage />
                              {dateWarnings.map((warning) => (
                                <p key={warning} className="text-sm text-amber-600 dark:text-amber-500">
                                  {warning}
                                </p>
                              ))}
                            </FormItem>
                          )
                        }}
                      />
                      {/* El motivo no se elige acá: lo fija el episodio desde el
                          que se abrió el modal. Se muestra para que quede claro
                          contra qué motivo se está registrando. */}
                      <div className="space-y-2">
                        <Label>Motivo</Label>
                        <div className="flex h-9 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3">
                          <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {effectiveEpisode
                              ? effectiveEpisode.mainComplaint || 'Sin motivo'
                              : 'Sin motivo asociado'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Evaluación del dolor */}
                    <div className="pt-2">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                        Evaluación del dolor
                      </Label>
                      {/* TODO: verificar cómo se maneja la remoción de una evaluación de dolor */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-3">
                        <FormField
                          control={form.control}
                          name="painScaleBefore"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Antes</span>
                                <span className={`text-2xl font-bold ${getPainColor(painBefore)}`}>
                                  {painBefore ?? '?'}
                                </span>
                              </div>
                              <FormControl>
                                <Slider
                                  value={[field.value ?? 0]}
                                  onValueChange={(v) => field.onChange(Array.isArray(v) ? v[0] : v)}
                                  max={10}
                                  step={1}
                                />
                              </FormControl>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Sin dolor</span>
                                <span>Máximo</span>
                              </div>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="painScaleAfter"
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center justify-between">
                                <span className="text-sm">Después</span>
                                <span className={`text-2xl font-bold ${getPainColor(painAfter)}`}>
                                  {painAfter ?? '?'}
                                </span>
                              </div>
                              <FormControl>
                                <Slider
                                  value={[field.value ?? 0]}
                                  onValueChange={(v) => field.onChange(Array.isArray(v) ? v[0] : v)}
                                  max={10}
                                  step={1}
                                />
                              </FormControl>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Sin dolor</span>
                                <span>Máximo</span>
                              </div>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Cobro (solo en creación) */}
                {!isEditing && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        Cobro de sesión
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="baseAmount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Monto base <span className="text-destructive">*</span>
                                {lastPriceData?.isStale === false && (
                                  <span className="text-muted-foreground font-normal ml-1 text-xs">
                                    (último precio)
                                  </span>
                                )}
                              </FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                    $
                                  </span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    placeholder="0.00"
                                    className="pl-7"
                                    {...field}
                                  />
                                </div>
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
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                    $
                                  </span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    placeholder="0.00"
                                    className="pl-7"
                                    {...field}
                                  />
                                </div>
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
                              <Input
                                placeholder="Ej: pagó mitad hoy, resto próxima semana"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Columna derecha - Notas clínicas */}
              <div className="space-y-6">
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Notas clínicas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="preSesionState"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Evaluación (estado pre-sesión)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="¿Cómo llegó el paciente? ¿Cambios desde la última sesión?"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Observaciones / técnicas */}
                    <FormField
                      control={form.control}
                      name="observations"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tratamiento</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Técnicas utilizadas, tiempos, zonas trabajadas..."
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
                              placeholder="Evaluación del dolor"
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
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                  </CardContent>
                </Card>
              </div>
            </div>

            <DialogFooter className="mt-6 pt-4 border-t gap-2 flex-col-reverse sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending} className="w-full sm:w-auto">
                {mutation.isPending ? 'Guardando...' : 'Guardar sesión'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    {/* Confirmación al cerrar con cambios sin guardar */}
    <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Descartar cambios?</DialogTitle>
          <DialogDescription>
            Tenés cambios sin guardar en la sesión. Si cerrás ahora, se perderán.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDiscardConfirm(false)}>
            Seguir editando
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setShowDiscardConfirm(false)
              onOpenChange(false)
            }}
          >
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
