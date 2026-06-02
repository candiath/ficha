import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { techniqueApi, techniqueKeys } from '@/services/techniques';
import type { Technique } from '@/types/technique';
import { toast } from 'sonner';

// ── Form dialog ────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
});

type FormValues = z.infer<typeof schema>;

function TechniqueFormDialog({
  open,
  onClose,
  technique,
}: {
  open: boolean;
  onClose: () => void;
  technique?: Technique;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!technique;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: technique?.name ?? '' },
  });

  const mutation = useMutation({
    mutationFn: ({ name }: FormValues) =>
      isEditing ? techniqueApi.update(technique.id, name) : techniqueApi.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: techniqueKeys.all });
      toast.success(isEditing ? 'Técnica actualizada' : 'Técnica creada');
      onClose();
      form.reset();
    },
    onError: () => toast.error('Error al guardar la técnica'),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar técnica' : 'Nueva técnica'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4 pt-1">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Rana en el suelo" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TechniquesPage() {
  useEffect(() => { document.title = 'Técnicas'; }, []);
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Technique | undefined>();

  const { data: techniques = [], isLoading } = useQuery({
    queryKey: techniqueKeys.all,
    queryFn: techniqueApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => techniqueApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: techniqueKeys.all });
      toast.success('Técnica eliminada');
    },
    onError: () => toast.error('Error al eliminar la técnica'),
  });

  function handleEdit(t: Technique) {
    setEditing(t);
    setFormOpen(true);
  }

  function handleClose() {
    setFormOpen(false);
    setEditing(undefined);
  }

  const global = techniques.filter((t) => t.isGlobal);
  const custom = techniques.filter((t) => !t.isGlobal);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Técnicas</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Catálogo de técnicas RPG utilizadas en las sesiones
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Nueva técnica
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : (
        <div className="space-y-6">
          {/* Técnicas globales */}
          {global.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Globales
              </h3>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="w-24">Tipo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {global.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">Global</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Técnicas personalizadas */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Personalizadas
            </h3>
            {custom.length === 0 ? (
              <div className="border rounded-lg py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No hay técnicas personalizadas aún.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Creá las tuyas con el botón de arriba.
                </p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="w-24">Tipo</TableHead>
                      <TableHead className="w-20 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {custom.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">Propia</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleEdit(t)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate(t.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      <TechniqueFormDialog open={formOpen} onClose={handleClose} technique={editing} />
    </div>
  );
}
