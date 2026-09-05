import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBeforeUnload } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { Calendar, CreditCard, FileText, ListChecks, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DirtyLabel } from '@/components/ui/dirty-label'
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
import type { Appointment } from '@ficha/shared'
import { appointmentKeys } from '@/services/appointments'
import { packageApi, packageKeys, paymentApi, paymentKeys } from '@/services/payments'
import { sessionApi } from '@/services/sessions'
import { episodeApi, episodeKeys } from '@/services/episodes'
import { globalSessionKeys } from '@/services/globalSessions'
import { SessionTypeBadge } from '@/components/sessions/SessionTypeBadge'
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
  /** El turno del que sale esta sesión, si se abre desde la agenda. Precarga
   *  la fecha y hora, y al guardar deja el turno marcado como atendido. */
  appointment?: Appointment
}

function getPainColor(value: number | null) {
  if (value === null) return 'text-muted-foreground'
  if (value <= 3) return 'text-emerald-600'
  if (value <= 6) return 'text-amber-600'
  return 'text-red-600'
}

/**
 * Campo del formulario con marca de "modificado sin guardar": el chip
 * DirtyLabel que ya usa la evaluación inicial, más una barra ámbar a la
 * izquierda del control para poder escanear la columna de un vistazo.
 *
 * El borde existe siempre (transparente cuando está limpio) y el margen
 * negativo mete la barra en el padding de la tarjeta: así aparecer la marca no
 * corre ni un pixel del contenido.
 */
function DirtyFieldItem({
  dirty,
  label,
  children,
}: {
  dirty?: boolean
  /** Sin label, el llamador arma su propia cabecera (los sliders de dolor
   *  necesitan el valor grande alineado a la derecha). */
  label?: ReactNode
  children: ReactNode
}) {
  return (
    <FormItem
      className={`-ml-3 border-l-2 pl-3 ${dirty ? 'border-amber-500' : 'border-transparent'}`}
    >
      {label !== undefined && (
        <FormLabel>
          <DirtyLabel label={label} dirty={dirty} />
        </FormLabel>
      )}
      {children}
    </FormItem>
  )
}

export default function SessionFormModalWide({
  open,
  onOpenChange,
  patientId,
  episodeId,
  session,
  sessionType = 'SESSION',
  onSuccess,
  appointment,
}: SessionFormModalWideProps) {
  const queryClient = useQueryClient()
  const isEditing = !!session
  const dateTolerances = useSessionDateTolerances()
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
        // Desde la agenda, la fecha y hora salen del turno: es exactamente el
        // dato que el turno ya tenía y que no hay que volver a cargar.
        sessionDate: toLocalDateTimeInput(
          appointment ? new Date(appointment.startsAt) : new Date(),
        ),
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
  }, [open, session, episodeId, isEditing, appointment, form])

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
        // Va en el mismo request: la API crea la sesión y vincula el turno en
        // una transacción, así no puede quedar una sesión registrada con el
        // turno todavía pidiendo que se registre.
        ...(appointment ? { appointmentId: appointment.id } : {}),
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
      // El turno pasó a "atendido": la agenda tiene que reflejarlo.
      if (appointment) {
        queryClient.invalidateQueries({ queryKey: appointmentKeys.all })
      }
      toast.success(isEditing ? 'Sesión actualizada' : 'Sesión registrada')
      onOpenChange(false)
      form.reset()
      onSuccess?.()
    },
    onError: () => {
      toast.error('Error al guardar la sesión')
    },
  })

  // Borrado de una sesión cargada por error. Invalida lo mismo que el guardado
  // —listados del paciente, episodios, listado global y cobros— porque el
  // borrado también se lleva el cobro pendiente de la sesión.
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('No hay sesión que eliminar')
      return sessionApi.remove(patientId, session.id)
    },
    onSuccess: () => {
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
      toast.success('Sesión eliminada')
      setShowDeleteConfirm(false)
      onOpenChange(false)
      form.reset()
      onSuccess?.()
    },
    onError: (err: Error) => {
      // El 409 de "ya está cobrada" trae un mensaje que le sirve al usuario
      // (dice qué hacer antes), así que se muestra tal cual en vez de un
      // genérico. api.ts ya lo trae en err.message.
      toast.error(err.message || 'Error al eliminar la sesión')
      setShowDeleteConfirm(false)
    },
  })

  const painBefore = form.watch('painScaleBefore')
  const painAfter = form.watch('painScaleAfter')

  const hasUnsavedChanges = form.formState.isDirty
  // Qué campos cambiaron respecto de los valores con que se abrió el modal:
  // alimenta la marca ámbar de cada campo. RHF los compara contra el último
  // reset, así que volver un campo a su valor original lo saca de acá.
  const { dirtyFields } = form.formState

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
          <div className="flex items-start justify-between gap-4">
            <DialogTitle className="text-xl">
              {isEditing
                ? 'Sesión registrada'
                : sessionType === 'DISCHARGE'
                  ? 'Registrar alta'
                  : 'Nueva sesión'}
            </DialogTitle>
            {/* El tipo ya no se edita, pero sigue distinguiendo una nota rápida
                o un alta de una sesión común. El badge no aparece para una
                sesión común: ahí no habría nada que distinguir. */}
            {isEditing && <SessionTypeBadge type={session.sessionType} className="shrink-0" />}
          </div>
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
                            <DirtyFieldItem dirty={dirtyFields.sessionDate} label="Fecha y hora">
                              <FormControl>
                                <Input type="datetime-local" {...field} />
                              </FormControl>
                              <FormMessage />
                              {dateWarnings.map((warning) => (
                                <p key={warning} className="text-sm text-amber-600 dark:text-amber-500">
                                  {warning}
                                </p>
                              ))}
                            </DirtyFieldItem>
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
                            <DirtyFieldItem dirty={dirtyFields.painScaleBefore}>
                              <div className="flex items-center justify-between">
                                <DirtyLabel label="Antes" dirty={dirtyFields.painScaleBefore} />
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
                            </DirtyFieldItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="painScaleAfter"
                          render={({ field }) => (
                            <DirtyFieldItem dirty={dirtyFields.painScaleAfter}>
                              <div className="flex items-center justify-between">
                                <DirtyLabel label="Después" dirty={dirtyFields.painScaleAfter} />
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
                            </DirtyFieldItem>
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
                            <DirtyFieldItem dirty={dirtyFields.packageId} label="Paquete">
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
                            </DirtyFieldItem>
                          )}
                        />
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="baseAmount"
                          render={({ field }) => (
                            <DirtyFieldItem
                              dirty={dirtyFields.baseAmount}
                              label={
                                <>
                                  Monto base <span className="text-destructive">*</span>
                                  {lastPriceData?.isStale === false && (
                                    <span className="text-muted-foreground font-normal text-xs">
                                      (último precio)
                                    </span>
                                  )}
                                </>
                              }
                            >
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
                            </DirtyFieldItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="discount"
                          render={({ field }) => (
                            <DirtyFieldItem dirty={dirtyFields.discount} label="Descuento">
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
                            </DirtyFieldItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="paymentNotes"
                        render={({ field }) => (
                          <DirtyFieldItem dirty={dirtyFields.paymentNotes} label="Notas de pago">
                            <FormControl>
                              <Input
                                placeholder="Ej: pagó mitad hoy, resto próxima semana"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </DirtyFieldItem>
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
                        <DirtyFieldItem dirty={dirtyFields.preSesionState} label="Evaluación (estado pre-sesión)">
                          <FormControl>
                            <Textarea
                              placeholder="¿Cómo llegó el paciente? ¿Cambios desde la última sesión?"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </DirtyFieldItem>
                      )}
                    />

                    {/* Observaciones / técnicas */}
                    <FormField
                      control={form.control}
                      name="observations"
                      render={({ field }) => (
                        <DirtyFieldItem dirty={dirtyFields.observations} label="Tratamiento">
                          <FormControl>
                            <Textarea
                              placeholder="Técnicas utilizadas, tiempos, zonas trabajadas..."
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </DirtyFieldItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="reEvaluationNotes"
                      render={({ field }) => (
                        <DirtyFieldItem dirty={dirtyFields.reEvaluationNotes} label="Re-evaluación">
                          <FormControl>
                            <Textarea
                              placeholder="Evaluación del dolor"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </DirtyFieldItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="patientResponse"
                      render={({ field }) => (
                        <DirtyFieldItem dirty={dirtyFields.patientResponse} label="Respuesta del paciente">
                          <FormControl>
                            <Textarea
                              placeholder="¿Cómo respondió a las posturas trabajadas?"
                              rows={3}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </DirtyFieldItem>
                      )}
                    />
                    
                  </CardContent>
                </Card>
              </div>
            </div>

            <DialogFooter className="mt-6 pt-4 border-t gap-2 flex-col-reverse sm:flex-row">
              {/* Solo al editar: una sesión que todavía no existe no se borra.
                  sm:mr-auto lo separa de las acciones de guardado — es una
                  acción destructiva y no debe quedar pegada a "Guardar". */}
              {isEditing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteMutation.isPending}
                  className="w-full sm:w-auto sm:mr-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancelar
              </Button>
              {/* Al editar, guardar sin cambios sería un PATCH que no cambia
                  nada (y una entrada de auditoría de más), así que el botón
                  espera a que haya algo que guardar. Al crear queda siempre
                  habilitado: una sesión con los valores por defecto es válida,
                  y el monto base lo exige el handleSubmit de arriba. */}
              <Button
                type="submit"
                disabled={mutation.isPending || (isEditing && !hasUnsavedChanges)}
                className="w-full sm:w-auto"
              >
                {mutation.isPending ? 'Guardando...' : 'Guardar sesión'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    {/* Confirmación de borrado */}
    <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar esta sesión?</DialogTitle>
          <DialogDescription>
            Deja de aparecer en el historial del paciente, en el listado de sesiones y
            en las estadísticas. Si tenía un cobro pendiente, también se elimina.
            {' '}Si la sesión ya está cobrada, primero hay que revertir el cobro.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar sesión'}
          </Button>
        </DialogFooter>
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
