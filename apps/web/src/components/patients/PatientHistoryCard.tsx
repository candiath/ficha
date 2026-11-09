import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, History, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  elapsedSince,
  formatPartialDate,
  partialDateAgo,
  type PartialDate,
  type RelativeUnit,
} from '@ficha/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { todayInClinic } from '@/lib/agendaDates';
import { PATIENT_EVENT_KIND_LABELS } from '@/lib/labels';
import { patientEventApi, patientEventKeys } from '@/services/patientEvents';
import { tenantApi, tenantKeys } from '@/services/tenant';
import { PATIENT_EVENT_KINDS, type PatientEvent, type PatientEventKind } from '@/types/patientEvent';
import type { AnnulData } from '@/types/patient';
import RevisionReasonField, { MISSING_REASON } from '@/components/patients/RevisionReasonField';
import { useRevisionReason } from '@/hooks/useRevisionReason';
import StaleRecordNotice from '@/components/patients/StaleRecordNotice'
import { isStaleEdit } from '@/lib/staleEdit';
import { ApiError } from '@/lib/api';
import RevisionHistoryDialog from '@/components/patients/RevisionHistoryDialog';
import AnnulDialog from '@/components/patients/AnnulDialog';
import { renderPatientEventSnapshot } from '@/lib/revisionRows';
import { revisionPaths } from '@/services/revisions';

// The patient's history ("Antecedentes", #238): what she lived, as dated facts.
// It belongs to the patient, so the same list shows from every episode. An
// event entered by mistake is annulled, not deleted: it stays, struck through,
// with its history (SPEC-clinical-revisions.md §8).

function useClinicToday(): string {
  const { data: tenant } = useQuery({ queryKey: tenantKeys.config, queryFn: tenantApi.get });
  return todayInClinic(tenant?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function describeWhen(occurred: PartialDate | null, today: string): string {
  return occurred ? `${formatPartialDate(occurred)} · ${elapsedSince(occurred, today)}` : 'Sin fecha';
}

export function PatientHistoryCard({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const today = useClinicToday();
  const [editing, setEditing] = useState<PatientEvent | 'new' | null>(null);
  const [annulling, setAnnulling] = useState<PatientEvent | null>(null);
  const [historyOf, setHistoryOf] = useState<PatientEvent | null>(null);

  const { data: events = [], isLoading, refetch } = useQuery({
    queryKey: patientEventKeys.list(patientId),
    queryFn: () => patientEventApi.list(patientId),
  });

  const annulMutation = useMutation({
    mutationFn: ({ id, reason, reasonNote }: { id: string } & AnnulData) =>
      patientEventApi.annul(patientId, id, { reason, reasonNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientEventKeys.list(patientId) });
      toast.success('Antecedente anulado');
      setAnnulling(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'No se pudo anular el antecedente');
      // Annulled or gone meanwhile (404): the list shows what it is now, and
      // there is nothing left to annul.
      if (err instanceof ApiError && err.status === 404) {
        queryClient.invalidateQueries({ queryKey: patientEventKeys.list(patientId) });
        setAnnulling(null);
      }
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Antecedentes
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Son del paciente: se ven desde todos sus episodios.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin antecedentes registrados.</p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className={`min-w-0 space-y-1 ${event.annulledAt ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{PATIENT_EVENT_KIND_LABELS[event.kind]}</Badge>
                    {event.annulledAt && <Badge variant="destructive">Anulado</Badge>}
                    <span className="text-xs text-muted-foreground">{describeWhen(event.occurred, today)}</span>
                  </div>
                  <p className={`text-sm ${event.annulledAt ? 'line-through' : ''}`}>{event.description}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label="Ver historial del antecedente"
                    title="Ver historial"
                    onClick={() => setHistoryOf(event)}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                  {/* An annulled event is read, never edited: only its history. */}
                  {!event.annulledAt && (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label="Editar antecedente"
                        onClick={() => setEditing(event)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label="Anular antecedente"
                        title="Anular"
                        onClick={() => setAnnulling(event)}
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {historyOf && (
        <RevisionHistoryDialog
          open
          onOpenChange={(o) => !o && setHistoryOf(null)}
          patientId={patientId}
          base={revisionPaths.patientEvent(patientId, historyOf.id)}
          title="Historial del antecedente"
          render={renderPatientEventSnapshot}
        />
      )}

      {editing && (
        // Mounted per event and version, so its state starts from that one,
        // and a reload after a 409 starts it again from the version just read.
        <PatientEventDialog
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.version}`}
          patientId={patientId}
          event={editing === 'new' ? undefined : editing}
          today={today}
          onClose={() => setEditing(null)}
          onReload={async () => {
            if (editing === 'new') return;
            const fresh = (await refetch()).data?.find((e) => e.id === editing.id);
            // Gone meanwhile: nothing left to edit.
            setEditing(fresh ?? null);
          }}
        />
      )}

      <AnnulDialog
        open={annulling !== null}
        onOpenChange={(open) => !open && setAnnulling(null)}
        title="¿Anular este antecedente?"
        description="Queda en la ficha tachado, con su historial, y ya no se puede editar."
        pending={annulMutation.isPending}
        onConfirm={(reason, reasonNote) =>
          annulling && annulMutation.mutate({ id: annulling.id, reason, reasonNote })
        }
      />
    </Card>
  );
}

// ─── The dialog ─────────────────────────────────────────────────────────────

// How the patient says when: a date, a month, a year, "hace N…", or she does
// not know. "Hace N…" is turned into a date right here, with today's date.
type When = 'AGO' | 'DAY' | 'MONTH' | 'YEAR' | 'UNKNOWN';

const WHEN_LABELS: Record<When, string> = {
  AGO: 'Hace…',
  DAY: 'Fecha',
  MONTH: 'Mes',
  YEAR: 'Año',
  UNKNOWN: 'No sabe',
};

const UNIT_LABELS: Record<RelativeUnit, string> = {
  DAYS: 'días',
  WEEKS: 'semanas',
  MONTHS: 'meses',
  YEARS: 'años',
};

interface WhenState {
  when: When;
  day: string;
  month: string;
  year: string;
  agoAmount: string;
  agoUnit: RelativeUnit;
  approximate: boolean;
}

function initialWhen(occurred: PartialDate | null | undefined): WhenState {
  const base: WhenState = {
    when: 'AGO',
    day: '',
    month: '',
    year: '',
    agoAmount: '',
    agoUnit: 'MONTHS',
    approximate: false,
  };
  if (occurred === undefined) return base;
  if (occurred === null) return { ...base, when: 'UNKNOWN' };
  const approximate = occurred.approximate;
  if (occurred.precision === 'DAY') return { ...base, when: 'DAY', day: occurred.date, approximate };
  if (occurred.precision === 'MONTH') return { ...base, when: 'MONTH', month: occurred.date.slice(0, 7), approximate };
  return { ...base, when: 'YEAR', year: occurred.date.slice(0, 4), approximate };
}

// The partial date the form describes; undefined while it is incomplete.
function occurredFrom(s: WhenState, today: string): PartialDate | null | undefined {
  if (s.when === 'UNKNOWN') return null;
  if (s.when === 'AGO') {
    const amount = Number(s.agoAmount);
    return Number.isInteger(amount) && amount >= 1 ? partialDateAgo(amount, s.agoUnit, today) : undefined;
  }
  if (s.when === 'DAY') return s.day ? { date: s.day, precision: 'DAY', approximate: s.approximate } : undefined;
  if (s.when === 'MONTH') {
    return s.month ? { date: `${s.month}-01`, precision: 'MONTH', approximate: s.approximate } : undefined;
  }
  return /^\d{4}$/.test(s.year) ? { date: `${s.year}-01-01`, precision: 'YEAR', approximate: s.approximate } : undefined;
}

function PatientEventDialog({
  patientId,
  event,
  today,
  onClose,
  onReload,
}: {
  patientId: string;
  event?: PatientEvent;
  today: string;
  onClose: () => void;
  // Reads the event again after a 409, and opens this dialog on it.
  onReload: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<PatientEventKind | null>(event?.kind ?? null);
  const [description, setDescription] = useState(event?.description ?? '');
  const [whenState, setWhenState] = useState<WhenState>(() => initialWhen(event?.occurred));
  // An edit is a correction: it says why, and names the version it was made
  // over (SPEC-clinical-revisions.md §4, §5).
  const revision = useRevisionReason();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const occurred = occurredFrom(whenState, today);
  const isFuture = !!occurred && occurred.date > today;
  const canSave = kind !== null && description.trim().length >= 2 && occurred !== undefined && !isFuture;
  const set = (patch: Partial<WhenState>) => setWhenState((s) => ({ ...s, ...patch }));

  const mutation = useMutation({
    mutationFn: () => {
      const data = { kind: kind!, description, occurred: occurred ?? null };
      if (!event) return patientEventApi.create(patientId, data);
      // The button checked it; this keeps a correction from leaving without one.
      if (!revision.reason) throw new Error(MISSING_REASON);
      return patientEventApi.update(patientId, event.id, {
        ...data,
        expectedVersion: event.version,
        reason: revision.reason,
        reasonNote: revision.note,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientEventKeys.list(patientId) });
      toast.success(event ? 'Antecedente actualizado' : 'Antecedente registrado');
      onClose();
    },
    onError: (err: Error) => {
      if (event && isStaleEdit(err)) {
        setStaleMessage(err.message);
        return;
      }
      toast.error(err.message || 'No se pudo guardar el antecedente');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? 'Editar antecedente' : 'Nuevo antecedente'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select
              items={PATIENT_EVENT_KIND_LABELS}
              value={kind}
              onValueChange={(v) => v !== null && setKind(v as PatientEventKind)}
            >
              <SelectTrigger className="w-full" aria-label="Tipo">
                <SelectValue placeholder="Elegir..." />
              </SelectTrigger>
              <SelectContent>
                {PATIENT_EVENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {PATIENT_EVENT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">Descripción</Label>
            <Input
              id="event-description"
              placeholder="Ej: Fractura de muñeca izquierda, tratada con yeso"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Cuándo</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(WHEN_LABELS) as When[]).map((w) => (
                <Button
                  key={w}
                  type="button"
                  size="sm"
                  variant={whenState.when === w ? 'default' : 'outline'}
                  aria-pressed={whenState.when === w}
                  onClick={() => set({ when: w })}
                >
                  {WHEN_LABELS[w]}
                </Button>
              ))}
            </div>

            {whenState.when === 'AGO' && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={1}
                  aria-label="Cantidad"
                  className="w-24"
                  value={whenState.agoAmount}
                  onChange={(e) => set({ agoAmount: e.target.value })}
                />
                <Select
                  items={UNIT_LABELS}
                  value={whenState.agoUnit}
                  onValueChange={(v) => v !== null && set({ agoUnit: v as RelativeUnit })}
                >
                  <SelectTrigger className="w-36" aria-label="Unidad">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(UNIT_LABELS) as RelativeUnit[]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {whenState.when === 'DAY' && (
              <Input
                type="date"
                aria-label="Fecha"
                max={today}
                value={whenState.day}
                onChange={(e) => set({ day: e.target.value })}
              />
            )}
            {whenState.when === 'MONTH' && (
              <Input
                type="month"
                aria-label="Mes"
                max={today.slice(0, 7)}
                value={whenState.month}
                onChange={(e) => set({ month: e.target.value })}
              />
            )}
            {whenState.when === 'YEAR' && (
              <Input
                type="number"
                aria-label="Año"
                min={1900}
                max={Number(today.slice(0, 4))}
                placeholder="Ej: 2019"
                className="w-32"
                value={whenState.year}
                onChange={(e) => set({ year: e.target.value })}
              />
            )}
            {(whenState.when === 'DAY' || whenState.when === 'MONTH' || whenState.when === 'YEAR') && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={whenState.approximate}
                  onCheckedChange={(checked) => set({ approximate: checked === true })}
                />
                Aproximada
              </label>
            )}

            {/* Lo que queda guardado: "hace dos meses" ya convertido en el mes. */}
            {occurred !== undefined && (
              <p className={`text-xs ${isFuture ? 'text-destructive' : 'text-muted-foreground'}`}>
                {isFuture
                  ? 'La fecha no puede ser futura.'
                  : `Queda registrado como: ${occurred ? formatPartialDate(occurred) : 'sin fecha'}`}
              </p>
            )}
          </div>

          {event && (
            <RevisionReasonField {...revision.fieldProps} />
          )}
          {staleMessage && (
            <StaleRecordNotice
              message={staleMessage}
              reloading={reloading}
              onReload={() => {
                setReloading(true);
                void onReload().finally(() => setReloading(false));
              }}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!canSave || mutation.isPending} onClick={() => (!event || revision.require()) && mutation.mutate()}>
            {mutation.isPending ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
