import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StickyNote, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { patientApi, patientKeys } from '@/services/patients';
import { sessionApi } from '@/services/sessions';
import { globalSessionKeys } from '@/services/globalSessions';
import { toast } from 'sonner';

export default function QuickNoteButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string;
    fullName: string;
  } | null>(null);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();

  const { data: patients = [] } = useQuery({
    queryKey: patientKeys.all,
    queryFn: patientApi.list,
    enabled: open,
  });

  const filtered =
    query.length > 0
      ? patients.filter((p) =>
          p.fullName.toLowerCase().includes(query.toLowerCase()),
        )
      : patients.slice(0, 5);

  const mutation = useMutation({
    mutationFn: () =>
      sessionApi.create(selectedPatient!.id, {
        sessionType: 'NOTE',
        sessionDate: new Date().toISOString(),
        painScaleBefore: null,
        painScaleAfter: null,
        preSesionState: null,
        reEvaluationNotes: null,
        patientResponse: null,
        observations: note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: globalSessionKeys.all });
      toast.success('Nota clínica guardada');
      handleClose();
    },
    onError: () => toast.error('Error al guardar la nota'),
  });

  function handleClose() {
    setOpen(false);
    setQuery('');
    setSelectedPatient(null);
    setNote('');
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon"
            className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow"
            onClick={() => setOpen(true)}
          >
            <StickyNote className="h-6 w-6" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Nota rápida</p>
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-5 w-5 text-primary" />
              Nota clínica rápida
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Registrá una nota clínica sin salir de la pantalla actual.
            </p>
          </DialogHeader>

          {!selectedPatient ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar paciente..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>
              {filtered.length > 0 && (
                <div className="border rounded-lg max-h-52 overflow-auto divide-y">
                  {filtered.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-3"
                      onClick={() => {
                        setSelectedPatient({ id: p.id, fullName: p.fullName });
                        setQuery('');
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                        {p.fullName
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')}
                      </div>
                      <span>{p.fullName}</span>
                    </button>
                  ))}
                </div>
              )}
              {query && filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Sin resultados para "{query}"
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Paciente seleccionado */}
              <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                    {selectedPatient.fullName
                      .split(' ')
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{selectedPatient.fullName}</p>
                    <p className="text-xs text-muted-foreground">Nota clínica</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedPatient(null)}
                >
                  Cambiar
                </Button>
              </div>

              {/* Nota */}
              <Textarea
                placeholder="Escribí la nota clínica...&#10;&#10;Ej: Paciente refiere mejoría durante la semana. Se recomendó continuar con ejercicios."
                rows={5}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                className="resize-none"
              />

              <Button
                className="w-full"
                disabled={!note.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? 'Guardando...' : 'Guardar nota'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
