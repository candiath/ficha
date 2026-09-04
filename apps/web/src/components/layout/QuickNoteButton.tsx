import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StickyNote, Search, ChevronLeft } from 'lucide-react';
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
import { sessionApi, sessionKeys } from '@/services/sessions';
import { episodeApi, episodeKeys } from '@/services/episodes';
import { globalSessionKeys } from '@/services/globalSessions';
import { toast } from 'sonner';
import { EPISODE_STATUS_LABELS } from '@/lib/labels';
import type { ClinicalEpisode } from '@/types/episode';

type Step = 'patient' | 'episode' | 'note';

// Header del paciente seleccionado (reutilizado en steps episode y note)
function PatientHeader({
  fullName,
  episode,
  onBack,
}: {
  fullName: string;
  episode: ClinicalEpisode | null;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
          {fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
        </div>
        <div>
          <p className="text-sm font-medium">{fullName}</p>
          <p className="text-xs text-muted-foreground">
            {episode ? episode.mainComplaint || 'Sin motivo' : 'Seleccionar episodio'}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="text-xs" onClick={onBack}>
        <ChevronLeft className="h-3 w-3 mr-1" />
        Cambiar
      </Button>
    </div>
  );
}

export default function QuickNoteButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('patient');
  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; fullName: string } | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<ClinicalEpisode | null>(null);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();

  const { data: patients = [] } = useQuery({
    queryKey: patientKeys.all,
    queryFn: patientApi.list,
    enabled: open,
  });

  const { data: episodes = [], isLoading: episodesLoading } = useQuery({
    queryKey: episodeKeys.list(selectedPatient?.id ?? ''),
    queryFn: () => episodeApi.list(selectedPatient!.id),
    enabled: !!selectedPatient && step === 'episode',
  });

  const filteredPatients =
    patientQuery.length > 0
      ? patients.filter((p) => p.fullName.toLowerCase().includes(patientQuery.toLowerCase()))
      : patients.slice(0, 5);

  const mutation = useMutation({
    mutationFn: () =>
      sessionApi.create(selectedPatient!.id, {
        sessionType: 'NOTE',
        sessionDate: new Date().toISOString(),
        episodeIds: selectedEpisode ? [selectedEpisode.id] : [],
        painScaleBefore: null,
        painScaleAfter: null,
        preSesionState: null,
        reEvaluationNotes: null,
        patientResponse: null,
        observations: note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: globalSessionKeys.all });
      if (selectedPatient && selectedEpisode) {
        queryClient.invalidateQueries({
          queryKey: sessionKeys.list(selectedPatient.id, selectedEpisode.id),
        });
      }
      toast.success('Nota clínica guardada');
      handleClose();
    },
    onError: () => toast.error('Error al guardar la nota'),
  });

  function handleClose() {
    setOpen(false);
    setStep('patient');
    setPatientQuery('');
    setSelectedPatient(null);
    setSelectedEpisode(null);
    setNote('');
  }

  function selectPatient(id: string, fullName: string) {
    setSelectedPatient({ id, fullName });
    setPatientQuery('');
    setStep('episode');
  }

  function selectEpisode(ep: ClinicalEpisode) {
    setSelectedEpisode(ep);
    setStep('note');
  }

  return (
    <>
      <Tooltip>
        {/* render: el Trigger de Base UI renderiza un <button> propio; sin esto
            el Button quedaría anidado adentro (HTML inválido, error en consola). */}
        <TooltipTrigger
          render={
            <Button
              size="icon"
              className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow"
              onClick={() => setOpen(true)}
            >
              <StickyNote className="h-6 w-6" />
            </Button>
          }
        />
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
            {step === 'patient' && (
              <p className="text-sm text-muted-foreground">
                Registrá una nota clínica sin salir de la pantalla actual.
              </p>
            )}
            {step === 'episode' && (
              <p className="text-sm text-muted-foreground">
                Seleccioná el episodio al que pertenece esta nota.
              </p>
            )}
          </DialogHeader>

          {/* ── Paso 1: Selección de paciente ── */}
          {step === 'patient' && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar paciente..."
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>
              {filteredPatients.length > 0 && (
                <div className="border rounded-lg max-h-52 overflow-auto divide-y">
                  {filteredPatients.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-3"
                      onClick={() => selectPatient(p.id, p.fullName)}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                        {p.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </div>
                      <span>{p.fullName}</span>
                    </button>
                  ))}
                </div>
              )}
              {patientQuery && filteredPatients.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Sin resultados para "{patientQuery}"
                </p>
              )}
            </div>
          )}

          {/* ── Paso 2: Selección de episodio ── */}
          {step === 'episode' && selectedPatient && (
            <div className="space-y-3">
              <PatientHeader
                fullName={selectedPatient.fullName}
                episode={selectedEpisode}
                onBack={() => { setSelectedPatient(null); setStep('patient'); }}
              />

              {episodesLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">Cargando episodios...</p>
              ) : episodes.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Este paciente no tiene episodios activos.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Accedé a la ficha del paciente para crear un episodio primero.
                  </p>
                </div>
              ) : (
                <div className="border rounded-lg max-h-56 overflow-auto divide-y">
                  {episodes.map((ep, idx) => (
                    <button
                      key={ep.id}
                      type="button"
                      className="w-full text-left px-3 py-3 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-3"
                      onClick={() => selectEpisode(ep)}
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {ep.mainComplaint || `Episodio ${episodes.length - idx}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(ep.openedAt).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        ep.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : ep.status === 'DISCHARGED'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {EPISODE_STATUS_LABELS[ep.status]}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Paso 3: Nota ── */}
          {step === 'note' && selectedPatient && (
            <div className="space-y-4">
              <PatientHeader
                fullName={selectedPatient.fullName}
                episode={selectedEpisode}
                onBack={() => { setSelectedEpisode(null); setStep('episode'); }}
              />

              <Textarea
                placeholder="Escribí la nota clínica...&#10;&#10;Ej: Paciente refiere mejoría durante la semana."
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
