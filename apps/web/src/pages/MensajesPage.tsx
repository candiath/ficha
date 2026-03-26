import { useState } from 'react'
import { MessageSquare, Plus, Copy, Bell, AlertCircle, Calendar, CreditCard, Check } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  mockAlerts,
  mockPatients,
  messageTemplates,
} from '@/lib/mock-data'
import type { AlertType, MessageCategory } from '@/lib/mock-data'

const CATEGORY_LABELS: Record<MessageCategory, string> = {
  reminder:     'Recordatorio',
  cancellation: 'Cancelación',
  follow_up:    'Seguimiento',
  general:      'General',
}

const CATEGORY_VARIANT: Record<MessageCategory, 'default' | 'secondary' | 'outline'> = {
  reminder:     'default',
  cancellation: 'outline',
  follow_up:    'secondary',
  general:      'outline',
}

const ALERT_CONFIG: Record<AlertType, { label: string; icon: React.ElementType; classes: string }> = {
  follow_up: { label: 'Seguimiento', icon: Calendar,     classes: 'text-blue-700 bg-blue-50 border-blue-200' },
  no_show:   { label: 'Inasistencia',icon: AlertCircle,  classes: 'text-red-700 bg-red-50 border-red-200' },
  payment:   { label: 'Pago',        icon: CreditCard,   classes: 'text-amber-700 bg-amber-50 border-amber-200' },
  custom:    { label: 'Personalizada',icon: Bell,        classes: 'text-purple-700 bg-purple-50 border-purple-200' },
}

function interpolate(content: string, patientName: string) {
  return content
    .replace(/{nombre}/g, patientName || '{nombre}')
    .replace(/{fecha}/g, new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }))
    .replace(/{hora}/g, '10:00')
    .replace(/{profesional}/g, 'Lic. Martínez')
}

export default function MensajesPage() {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [selectedPatient,  setSelectedPatient]  = useState<string>('')
  const [preview,          setPreview]          = useState('')
  const [copied,           setCopied]           = useState(false)
  const [isNewOpen,        setIsNewOpen]        = useState(false)
  const [newName,          setNewName]          = useState('')
  const [newCategory,      setNewCategory]      = useState<string>('')
  const [newContent,       setNewContent]       = useState('')

  const unreadCount = mockAlerts.filter(a => !a.isRead).length

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplate(templateId)
    const tmpl = messageTemplates.find(t => t.id === templateId)
    if (!tmpl) return
    const patient = mockPatients.find(p => p.id === selectedPatient)
    setPreview(interpolate(tmpl.content, patient?.fullName.split(' ')[0] ?? ''))
  }

  function handlePatientSelect(patientId: string) {
    setSelectedPatient(patientId)
    const tmpl = messageTemplates.find(t => t.id === selectedTemplate)
    if (!tmpl) return
    const patient = mockPatients.find(p => p.id === patientId)
    setPreview(interpolate(tmpl.content, patient?.fullName.split(' ')[0] ?? ''))
  }

  function copyToClipboard() {
    if (!preview) return
    navigator.clipboard.writeText(preview)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function closeNew() {
    setIsNewOpen(false)
    setNewName('')
    setNewCategory('')
    setNewContent('')
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Mensajes y alertas</h2>
        <p className="text-muted-foreground text-sm mt-1">Plantillas de mensajes y alertas de seguimiento</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Plantillas</TabsTrigger>
          <TabsTrigger value="alerts">
            <span className="flex items-center gap-1.5">
              Alertas
              {unreadCount > 0 && (
                <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px] rounded-full">
                  {unreadCount}
                </Badge>
              )}
            </span>
          </TabsTrigger>
          <TabsTrigger value="send">Enviar mensaje</TabsTrigger>
        </TabsList>

        {/* ── Templates tab ─────────────────────────────────────────── */}
        <TabsContent value="templates" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsNewOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva plantilla
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {messageTemplates.map(tmpl => (
              <Card key={tmpl.id} className="flex flex-col">
                <CardContent className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h3 className="font-medium text-sm truncate">{tmpl.name}</h3>
                    </div>
                    <Badge variant={CATEGORY_VARIANT[tmpl.category]} className="shrink-0">
                      {CATEGORY_LABELS[tmpl.category]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex-1 line-clamp-3">
                    {tmpl.content}
                  </p>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(tmpl.content)}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copiar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Alerts tab ────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="space-y-3 mt-4">
          {mockAlerts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Bell className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium">Sin alertas</p>
              </CardContent>
            </Card>
          ) : (
            mockAlerts.map(alert => {
              const cfg  = ALERT_CONFIG[alert.type]
              const Icon = cfg.icon
              const patient = mockPatients.find(p => p.id === alert.patientId)
              return (
                <Card
                  key={alert.id}
                  className={alert.isRead ? 'opacity-60' : ''}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${cfg.classes}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cfg.classes}`}>
                            {cfg.label}
                          </span>
                          {patient && (
                            <span className="text-xs text-muted-foreground">{patient.fullName}</span>
                          )}
                          {!alert.isRead && (
                            <span className="ml-auto text-xs font-medium text-primary">Nueva</span>
                          )}
                        </div>
                        <p className="text-sm mt-1.5">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(alert.createdAt + 'T00:00:00').toLocaleDateString('es-AR', {
                            day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
                          })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        {/* ── Send tab ──────────────────────────────────────────────── */}
        <TabsContent value="send" className="mt-4">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left: selectors */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Paciente</Label>
                <Select value={selectedPatient} onValueChange={v => v !== null && handlePatientSelect(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar paciente" />
                  </SelectTrigger>
                  <SelectContent>
                    {mockPatients.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Plantilla</Label>
                <Select value={selectedTemplate} onValueChange={v => v !== null && handleTemplateSelect(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccionar plantilla" />
                  </SelectTrigger>
                  <SelectContent>
                    {messageTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="pt-2 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Variables disponibles: <code className="bg-muted px-1 rounded">{'{nombre}'}</code>,{' '}
                  <code className="bg-muted px-1 rounded">{'{fecha}'}</code>,{' '}
                  <code className="bg-muted px-1 rounded">{'{hora}'}</code>,{' '}
                  <code className="bg-muted px-1 rounded">{'{profesional}'}</code>
                </p>
              </div>
            </div>

            {/* Right: preview */}
            <div className="space-y-3">
              <Label>Vista previa del mensaje</Label>
              <div className="min-h-32 p-3 rounded-lg bg-muted/40 border border-border text-sm whitespace-pre-wrap">
                {preview || (
                  <span className="text-muted-foreground">
                    Seleccioná un paciente y una plantilla para ver la vista previa
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={copyToClipboard}
                disabled={!preview}
              >
                {copied ? (
                  <><Check className="h-4 w-4 mr-2 text-green-600" /> ¡Copiado!</>
                ) : (
                  <><Copy className="h-4 w-4 mr-2" /> Copiar mensaje</>
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* New Template Dialog */}
      <Dialog open={isNewOpen} onOpenChange={v => !v && closeNew()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crear plantilla de mensaje</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-name">Nombre de la plantilla</Label>
              <Input
                id="tmpl-name"
                placeholder="Ej: Recordatorio de turno"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={newCategory} onValueChange={v => v !== null && setNewCategory(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminder">Recordatorio</SelectItem>
                  <SelectItem value="cancellation">Cancelación</SelectItem>
                  <SelectItem value="follow_up">Seguimiento</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-content">Contenido del mensaje</Label>
              <Textarea
                id="tmpl-content"
                rows={4}
                placeholder={'Usá {nombre}, {fecha}, {hora} para variables'}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeNew}>Cancelar</Button>
              <Button onClick={closeNew}>Guardar plantilla</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
