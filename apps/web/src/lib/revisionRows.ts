import {
  CONSENT_SNAPSHOTS,
  DOCUMENT_TYPE_LABELS,
  EPISODE_SNAPSHOTS,
  EVALUATION_SNAPSHOTS,
  PATIENT_ANTECEDENT_SNAPSHOTS,
  PATIENT_SNAPSHOTS,
  ENCOUNTER_SNAPSHOTS,
  formatPartialDate,
  type SnapshotHistory,
} from '@ficha/shared';
import {
  EPISODE_STATUS_LABELS,
  PATIENT_ANTECEDENT_KIND_LABELS,
  ENCOUNTER_TYPE_LABELS,
  SEX_LABELS,
} from '@/lib/labels';
import { formatDay } from '@/lib/calendarDate';

// How a revision's snapshot reads on screen (SPEC-clinical-revisions.md §7):
// one renderer per aggregate turns its snapshot into labelled rows, read-only.
// A row's `compare` is what decides whether it changed from the version
// before; `value` is what is shown (they differ only where the value cannot
// be shown in full, like the body map).

export interface SnapshotRow {
  key: string;
  label: string;
  value: string;
  compare?: string;
  // Rows of one block of an encounter share a group: the problem it treated,
  // by its episode's id and named by its complaint (two may share a name).
  group?: { key: string; label: string };
}

export interface SnapshotRenderContext {
  // An encounter's block names its episode by complaint.
  episodeName?: (episodeId: string) => string;
}

export type SnapshotRenderer = (snapshot: unknown, schemaVersion: number, ctx: SnapshotRenderContext) => SnapshotRow[] | null;

const EMPTY = '—';

const text = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === '' ? EMPTY : v);
const num = (v: number | null) => (v === null ? EMPTY : String(v));

function dateTime(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function date(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// A date of birth is a day (YYYY-MM-DD, as the history reads every version of
// the patient snapshot): written out from its parts, with no time zone to shift it.
function day(value: string | null): string {
  return formatDay(value) ?? EMPTY;
}

// A snapshot is shown in the current shape, whatever schema version it was
// written with: its history reads it (packages/shared clinicalSnapshots.ts), so
// a field a later version added shows as empty in the versions before it. One
// of a version this build does not know, or that does not parse, renders as
// null: the dialog says so instead of guessing.
//
// A version change that REMOVES a field needs a renderer of its own for the
// old versions here, or what they held stops being shown.
function parsed<Current>(
  history: SnapshotHistory<Current>,
  version: number,
  snapshot: unknown,
  render: (s: Current) => SnapshotRow[],
) {
  const current = history.read(version, snapshot);
  return current === null ? null : render(current);
}

export const renderEncounterSnapshot: SnapshotRenderer = (snapshot, version, ctx) =>
  parsed(ENCOUNTER_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'encounterType', label: 'Tipo', value: ENCOUNTER_TYPE_LABELS[s.encounterType] ?? s.encounterType },
    { key: 'encounterDate', label: 'Fecha', value: dateTime(s.encounterDate) },
    ...(s.encounterType === 'NOTE' || s.observations ? [{ key: 'observations', label: 'Nota', value: text(s.observations) }] : []),
    ...s.episodes.flatMap((b) => {
      const group = { key: b.episodeId, label: `Motivo: ${ctx.episodeName?.(b.episodeId) ?? 'episodio'}` };
      const row = (field: string, label: string, value: string): SnapshotRow => ({
        key: `episodes.${b.episodeId}.${field}`,
        label,
        value,
        group,
      });
      return [
        row('preEncounterState', 'Estado previo', text(b.preEncounterState)),
        row('treatment', 'Tratamiento', text(b.treatment)),
        row('painScaleBefore', 'Dolor al inicio', num(b.painScaleBefore)),
        row('painScaleAfter', 'Dolor al final', num(b.painScaleAfter)),
        row('patientExercises', 'Ejercicios', text(b.patientExercises)),
        row('reEvaluationNotes', 'Reevaluación', text(b.reEvaluationNotes)),
      ];
    }),
  ]);

export const renderPatientSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(PATIENT_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'firstName', label: 'Nombre', value: text(s.firstName) },
    { key: 'lastName', label: 'Apellido', value: text(s.lastName) },
    { key: 'birthDate', label: 'Fecha de nacimiento', value: day(s.birthDate) },
    { key: 'sex', label: 'Sexo', value: s.sex ? (SEX_LABELS[s.sex] ?? s.sex) : EMPTY },
    {
      key: 'document',
      label: 'Documento',
      value: s.documentType && s.documentNumber ? `${DOCUMENT_TYPE_LABELS[s.documentType]} ${s.documentNumber}` : EMPTY,
    },
    { key: 'occupation', label: 'Ocupación', value: text(s.occupation) },
    { key: 'referringDoctor', label: 'Médico derivante', value: text(s.referringDoctor) },
  ]);

export const renderEpisodeSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(EPISODE_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'mainComplaint', label: 'Motivo de consulta', value: text(s.mainComplaint) },
    { key: 'status', label: 'Estado', value: EPISODE_STATUS_LABELS[s.status] ?? s.status },
    { key: 'openedAt', label: 'Apertura', value: date(s.openedAt) },
    { key: 'closedAt', label: 'Cierre', value: date(s.closedAt) },
  ]);

export const renderEvaluationSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(EVALUATION_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'evaluatedAt', label: 'Fecha de evaluación', value: date(s.evaluatedAt) },
    { key: 'patientNarrative', label: 'Relato del paciente', value: text(s.patientNarrative) },
    { key: 'otherHistory', label: 'Otros antecedentes', value: text(s.otherHistory) },
    { key: 'physicalActivity', label: 'Actividad física', value: text(s.physicalActivity) },
    { key: 'painFrequency', label: 'Frecuencia del dolor', value: text(s.painFrequency) },
    { key: 'painScale', label: 'Escala EVA', value: num(s.painScale) },
    { key: 'notes', label: 'Notas', value: text(s.notes) },
  ]);

export const renderConsentSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(CONSENT_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'signedAt', label: 'Firmado', value: dateTime(s.signedAt) },
    { key: 'revokedAt', label: 'Revocado', value: s.revokedAt ? dateTime(s.revokedAt) : 'No' },
  ]);

export const renderPatientAntecedentSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(PATIENT_ANTECEDENT_SNAPSHOTS, version, snapshot, (s) => [
    { key: 'kind', label: 'Tipo', value: PATIENT_ANTECEDENT_KIND_LABELS[s.kind] ?? s.kind },
    { key: 'description', label: 'Descripción', value: text(s.description) },
    {
      key: 'occurred',
      label: 'Fecha',
      value:
        s.occurredOn && s.occurredPrecision
          ? formatPartialDate({ date: s.occurredOn, precision: s.occurredPrecision, approximate: s.occurredApproximate })
          : 'Sin fecha',
    },
  ]);

// The keys of `rows` whose value differs from `previous` (or is new). Version
// 1 has no previous: nothing is marked.
export function changedKeys(rows: SnapshotRow[], previous: SnapshotRow[] | null): Set<string> {
  if (!previous) return new Set();
  const before = new Map(previous.map((r) => [r.key, r.compare ?? r.value]));
  return new Set(rows.filter((r) => before.get(r.key) !== (r.compare ?? r.value)).map((r) => r.key));
}

// What the version before had and this one does not, by name: a block removed
// from an encounter (its group), or a row shown only when it has a value (a
// encounter's note, cleared). Without it, a removal would mark nothing.
export function removedParts(rows: SnapshotRow[], previous: SnapshotRow[] | null): string[] {
  if (!previous) return [];
  const groups = new Set(rows.map((r) => r.group?.key));
  const keys = new Set(rows.map((r) => r.key));
  const removed = new Map<string, string>();
  for (const { key, label, group } of previous) {
    if (group) {
      if (!groups.has(group.key)) removed.set(`group:${group.key}`, group.label);
    } else if (!keys.has(key)) {
      removed.set(`row:${key}`, label);
    }
  }
  return [...removed.values()];
}
