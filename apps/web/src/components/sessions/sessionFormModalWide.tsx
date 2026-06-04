import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { toast } from 'sonner'
import { Calendar, CreditCard, FileText, Stethoscope } from 'lucide-react'
import {
  Dialog,
  DialogContent,
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
import SessionTechniquesPicker from '@/components/sessions/SessionTechniquesPicker'
import type { TechniqueEntry } from '@/components/sessions/SessionTechniquesPicker'
import { packageApi, packageKeys, paymentApi, paymentKeys } from '@/services/payments'
import { sessionApi, sessionKeys } from '@/services/sessions'
import { sessionTechniqueApi, sessionTechniqueKeys } from '@/services/sessionTechniques'
import { SESSION_TYPE_LABELS } from '@/lib/labels'
import type { Session } from '@/types/session'

const schema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']),
  sessionDate: z.string().min(1, 'La fecha es requerida'),
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
  session?: Session
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
  session,
}: SessionFormModalWideProps) {
  const queryClient = useQueryClient()
  const isEditing = !!session
  const [techniqueEntries, setTechniqueEntries] = useState<TechniqueEntry[]>([])

  const { data: existingTechniques } = useQuery({
    queryKey: sessionTechniqueKeys.list(patientId, session?.id ?? ''),
    queryFn: () => sessionTechniqueApi.list(patientId, session!.id),
    enabled: isEditing && !!session?.id,
  })

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
      )
    }
  }, [isEditing, existingTechniques])

  const { data: lastPriceData } = useQuery({
    queryKey: paymentKeys.lastBasePrice,
    queryFn: paymentApi.lastBasePrice,
    enabled: !isEditing,
  })

  const { data: packages = [] } = useQuery({
    queryKey: packageKeys.byPatient(patientId),
    queryFn: () => packageApi.list(patientId),
  })

  const activePackages = packages.filter((pkg) => pkg.remainingSessions > 0)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sessionType: 'SESSION',
      sessionDate: new Date().toISOString().slice(0, 16),
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
        sessionType: session.sessionType ?? 'SESSION',
        sessionDate: session.sessionDate
          ? new Date(session.sessionDate).toISOString().slice(0, 16)
          : new Date().toISOString().slice(0, 16),
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
        sessionType: 'SESSION',
        sessionDate: new Date().toISOString().slice(0, 16),
        painScaleBefore: null,
        painScaleAfter: null,
        preSesionState: '',
        reEvaluationNotes: '',
        patientResponse: '',
        observations: '',
        baseAmount: lastPriceData?.amount != null ? String(lastPriceData.amount) : '',
        discount: '',
        packageId: '',
        paymentNotes: '',
      })
      setTechniqueEntries([])
    }
  }, [open, session, lastPriceData])

  const selectedPackageId = form.watch('packageId')
  useEffect(() => {
    if (!selectedPackageId) return
    const pkg = activePackages.find((p) => p.id === selectedPackageId)
    if (pkg) form.setValue('baseAmount', String(pkg.pricePerSession))
  }, [selectedPackageId])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const sessionData = {
        sessionType: values.sessionType,
        sessionDate: new Date(values.sessionDate).toISOString(),
        painScaleBefore: values.painScaleBefore,
        painScaleAfter: values.painScaleAfter,
        preSesionState: values.preSesionState || null,
        reEvaluationNotes: values.reEvaluationNotes || null,
        patientResponse: values.patientResponse || null,
        observations: values.observations || null,
      }

      if (isEditing) {
        const updated = await sessionApi.update(patientId, session.id, sessionData)
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
          )
        }
        return updated
      }

      const newSession = await sessionApi.create(patientId, sessionData)
      await paymentApi.create({
        patientId,
        sessionId: newSession.id,
        packageId: values.packageId || null,
        baseAmount: parseFloat(values.baseAmount ?? '0'),
        discount: values.discount ? parseFloat(values.discount) : 0,
        notes: values.paymentNotes || null,
      })
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
        )
      }
      return newSession
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list(patientId) })
      queryClient.invalidateQueries({ queryKey: paymentKeys.all })
      toast.success(isEditing ? 'Sesión actualizada' : 'Sesión registrada')
      onOpenChange(false)
      form.reset()
    },
    onError: () => {
      toast.error('Error al guardar la sesión')
    },
  })

  const painBefore = form.watch('painScaleBefore')
  const painAfter = form.watch('painScaleAfter')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[95vw] lg:max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b bg-muted/30">
          <DialogTitle className="text-xl">
            {isEditing ? 'Editar sesión' : 'Nueva sesión'}
          </DialogTitle>
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
                            <FormLabel>Tipo de sesión</FormLabel>
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

                    {/* Evaluación del dolor */}
                    <div className="pt-2">
                      <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                        Evaluación del dolor
                      </Label>
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

                {/* Técnicas */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Stethoscope className="h-4 w-4 text-muted-foreground" />
                      Técnicas aplicadas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SessionTechniquesPicker
                      value={techniqueEntries}
                      onChange={setTechniqueEntries}
                    />
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
                          <FormLabel>Estado pre-sesión</FormLabel>
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
                    <FormField
                      control={form.control}
                      name="reEvaluationNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Re-evaluación</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Cambios posturales, rangos articulares, hallazgos..."
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
                    <FormField
                      control={form.control}
                      name="observations"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Observaciones / técnicas</FormLabel>
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
                  </CardContent>
                </Card>
              </div>
            </div>

            <DialogFooter className="mt-6 pt-4 border-t gap-2 flex-col-reverse sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
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
  )
}
