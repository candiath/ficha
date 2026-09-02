import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { PulseDot } from '@/components/ui/pulse-dot';
import { DirtyLabel } from '@/components/ui/dirty-label';
import { useEffect } from 'react';

// ── Sección: encabezado ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

// ── Sección: Toasts ──────────────────────────────────────────────────────────

function ToastsSection() {
  return (
    <Section title="Toasts — Sonner">
      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-6">
          <Button variant="outline" onClick={() => toast.success('Evaluación guardada')}>
            Success
          </Button>
          <Button variant="outline" onClick={() => toast.error('Error al guardar')}>
            Error
          </Button>
          <Button variant="outline" onClick={() => toast.warning('Cambios sin guardar')}>
            Warning
          </Button>
          <Button variant="outline" onClick={() => toast.info('Funcionalidad en desarrollo')}>
            Info
          </Button>
          <Button variant="outline" onClick={() => toast.loading('Guardando...')}>
            Loading
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.success('Evaluación guardada', {
                description: 'Los cambios se guardaron correctamente en la base de datos.',
              })
            }
          >
            Con descripción
          </Button>
        </CardContent>
      </Card>
    </Section>
  );
}

// ── Sección: PulseDot ────────────────────────────────────────────────────────

function PulseDotSection() {
  return (
    <Section title="PulseDot — Indicadores">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-8 items-center">
            <div className="flex items-center gap-2 text-sm">
              <PulseDot variant="new" />
              <span>new</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <PulseDot variant="demo" />
              <span>demo</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <PulseDot variant="wip" />
              <span>wip</span>
            </div>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">Uso en contexto:</p>
          <div className="flex flex-wrap gap-3">
            <Badge variant="outline" className="gap-1.5">
              <PulseDot variant="new" />
              Escalas funcionales
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <PulseDot variant="demo" />
              Descargar informe
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <PulseDot variant="wip" />
              Agenda
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Section>
  );
}

// ── Sección: DirtyLabel + formulario ────────────────────────────────────────

const demoSchema = z.object({
  name: z.string().min(1),
  occupation: z.string().optional(),
  notes: z.string().optional(),
});

type DemoForm = z.infer<typeof demoSchema>;

function FormSection() {
  const form = useForm<DemoForm>({
    resolver: zodResolver(demoSchema),
    defaultValues: { name: 'María García', occupation: 'Docente', notes: '' },
  });
  const { isDirty, dirtyFields } = form.formState;

  return (
    <Section title="Estados de formulario — DirtyLabel">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Editá un campo para ver el indicador de modificado. El botón se habilita al haber cambios.
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(() => {
                toast.success('Formulario guardado (demo)');
                form.reset(form.getValues());
              })}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <DirtyLabel label="Nombre completo" dirty={dirtyFields.name} />
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormLabel>
                      <DirtyLabel label="Ocupación" dirty={dirtyFields.occupation} />
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <DirtyLabel label="Notas" dirty={dirtyFields.notes} />
                    </FormLabel>
                    <FormControl>
                      <Textarea className="resize-none" rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={!isDirty}>
                  Guardar (demo)
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </Section>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function LabPage() {
  useEffect(() => {
    document.title = 'Lab — Ficha';
  }, []);

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-10">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-semibold tracking-tight">Lab</h1>
          <PulseDot variant="demo" />
        </div>
        <p className="text-sm text-muted-foreground">
          Entorno de pruebas — solo visible en desarrollo.
        </p>
      </div>

      <ToastsSection />
      <PulseDotSection />
      <FormSection />
    </div>
  );
}
