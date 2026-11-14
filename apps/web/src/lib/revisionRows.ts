import {
  ConsentSnapshotV1,
  EpisodeSnapshotV1,
  EvaluationSnapshotV1,
  PatientEventSnapshotV1,
  PatientSnapshotV1,
  SessionSnapshotV1,
  formatPartialDate,
} from '@ficha/shared';
import type { z } from 'zod';
import {
  EPISODE_STATUS_LABELS,
  PATIENT_EVENT_KIND_LABELS,
  SESSION_TYPE_LABELS,
  SEX_LABELS,
} from '@/lib/labels';

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
  // Rows of one block of a session share a group: the problem it treated,
  // by its episode's id and named by its complaint (two may share a name).
  group?: { key: string; label: string };
}

export interface SnapshotRenderContext {
  // A session's block names its episode by complaint.
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

// A date of birth is the ISO string of its UTC midnight: read in UTC, or the
// day before shows west of Greenwich.
function utcDate(iso: string | null): string {
  if (!iso) return EMPTY;
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// A snapshot of a schema version this screen does not know, or that does not
// parse, renders as null: the dialog says so instead of guessing.
function parsed<S extends z.ZodType>(schema: S, version: number, snapshot: unknown, render: (s: z.infer<S>) => SnapshotRow[]) {
  if (version !== 1) return null;
  const result = schema.safeParse(snapshot);
  return result.success ? render(result.data) : null;
}

export const renderSessionSnapshot: SnapshotRenderer = (snapshot, version, ctx) =>
  parsed(SessionSnapshotV1, version, snapshot, (s) => [
    { key: 'sessionType', label: 'Tipo', value: SESSION_TYPE_LABELS[s.sessionType] ?? s.sessionType },
    { key: 'sessionDate', label: 'Fecha', value: dateTime(s.sessionDate) },
    ...(s.sessionType === 'NOTE' || s.observations ? [{ key: 'observations', label: 'Nota', value: text(s.observations) }] : []),
    ...s.episodes.flatMap((b) => {
      const group = { key: b.episodeId, label: `Motivo: ${ctx.episodeName?.(b.episodeId) ?? 'episodio'}` };
      const row = (field: string, label: string, value: string): SnapshotRow => ({
        key: `episodes.${b.episodeId}.${field}`,
        label,
        value,
        group,
      });
      return [
        row('preSessionState', 'Estado previo', text(b.preSessionState)),
        row('treatment', 'Tratamiento', text(b.treatment)),
        row('painScaleBefore', 'Dolor al inicio', num(b.painScaleBefore)),
        row('painScaleAfter', 'Dolor al final', num(b.painScaleAfter)),
        row('patientExercises', 'Ejercicios', text(b.patientExercises)),
        row('reEvaluationNotes', 'Reevaluación', text(b.reEvaluationNotes)),
      ];
    }),
  ]);

export const renderPatientSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(PatientSnapshotV1, version, snapshot, (s) => [
    { key: 'firstName', label: 'Nombre', value: text(s.firstName) },
    { key: 'lastName', label: 'Apellido', value: text(s.lastName) },
    { key: 'birthDate', label: 'Fecha de nacimiento', value: utcDate(s.birthDate) },
    { key: 'sex', label: 'Sexo', value: s.sex ? (SEX_LABELS[s.sex] ?? s.sex) : EMPTY },
    { key: 'occupation', label: 'Ocupación', value: text(s.occupation) },
    { key: 'referringDoctor', label: 'Médico derivante', value: text(s.referringDoctor) },
  ]);

export const renderEpisodeSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(EpisodeSnapshotV1, version, snapshot, (s) => [
    { key: 'mainComplaint', label: 'Motivo de consulta', value: text(s.mainComplaint) },
    { key: 'status', label: 'Estado', value: EPISODE_STATUS_LABELS[s.status] ?? s.status },
    { key: 'openedAt', label: 'Apertura', value: date(s.openedAt) },
    { key: 'closedAt', label: 'Cierre', value: date(s.closedAt) },
  ]);

export const renderEvaluationSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(EvaluationSnapshotV1, version, snapshot, (s) => [
    { key: 'evaluatedAt', label: 'Fecha de evaluación', value: date(s.evaluatedAt) },
    { key: 'patientNarrative', label: 'Relato del paciente', value: text(s.patientNarrative) },
    { key: 'otherHistory', label: 'Otros antecedentes', value: text(s.otherHistory) },
    { key: 'physicalActivity', label: 'Actividad física', value: text(s.physicalActivity) },
    { key: 'painFrequency', label: 'Frecuencia del dolor', value: text(s.painFrequency) },
    { key: 'evaScale', label: 'Escala EVA', value: num(s.evaScale) },
    { key: 'notes', label: 'Notas', value: text(s.notes) },
    // Its shape is not defined yet (spec §3): whether it changed is shown, not
    // the drawing.
    {
      key: 'retractionMap',
      label: 'Mapa de retracciones',
      value: s.retractionMap === null || s.retractionMap === undefined ? 'Sin marcar' : 'Con marcas',
      compare: JSON.stringify(s.retractionMap ?? null),
    },
  ]);

export const renderConsentSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(ConsentSnapshotV1, version, snapshot, (s) => [
    { key: 'signedAt', label: 'Firmado', value: dateTime(s.signedAt) },
    { key: 'revokedAt', label: 'Revocado', value: s.revokedAt ? dateTime(s.revokedAt) : 'No' },
  ]);

export const renderPatientEventSnapshot: SnapshotRenderer = (snapshot, version) =>
  parsed(PatientEventSnapshotV1, version, snapshot, (s) => [
    { key: 'kind', label: 'Tipo', value: PATIENT_EVENT_KIND_LABELS[s.kind] ?? s.kind },
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
// from a session (its group), or a row shown only when it has a value (a
// session's note, cleared). Without it, a removal would mark nothing.
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
