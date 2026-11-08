import { describe, expect, it } from 'vitest';
import {
  changedKeys,
  removedGroups,
  renderConsentSnapshot,
  renderEpisodeSnapshot,
  renderEvaluationSnapshot,
  renderPatientEventSnapshot,
  renderPatientSnapshot,
  renderSessionSnapshot,
  type SnapshotRow,
} from '@/lib/revisionRows';

// Each aggregate's snapshot, read-only (SPEC-clinical-revisions.md §7): what
// the history dialog shows of one version, and what it marks as changed.
const view = (rows: SnapshotRow[] | null) => Object.fromEntries((rows ?? []).map((r) => [r.label, r.value]));

describe('snapshot renderers', () => {
  it('the patient: identification and clinical context, the birth date in UTC', () => {
    const rows = renderPatientSnapshot(
      {
        firstName: 'Ana',
        lastName: 'Pérez',
        birthDate: '1990-03-01T00:00:00.000Z',
        sex: 'FEMALE',
        occupation: null,
        referringDoctor: 'Dr. López',
      },
      1,
      {},
    );
    expect(view(rows)).toEqual({
      Nombre: 'Ana',
      Apellido: 'Pérez',
      'Fecha de nacimiento': '01/03/1990',
      Sexo: 'Femenino',
      Ocupación: '—',
      'Médico derivante': 'Dr. López',
    });
  });

  it('the episode: complaint, status and dates', () => {
    const rows = renderEpisodeSnapshot(
      { status: 'DISCHARGED', mainComplaint: 'Lumbalgia', openedAt: '2026-01-05T12:00:00.000Z', closedAt: null },
      1,
      {},
    );
    expect(view(rows)).toEqual({ 'Motivo de consulta': 'Lumbalgia', Estado: 'Alta', Apertura: '05/01/2026', Cierre: '—' });
  });

  it('the evaluation: its texts, and whether the body map has marks, never its drawing', () => {
    const snapshot = {
      patientNarrative: 'Dolor al levantarse',
      otherHistory: null,
      notes: '',
      retractionMap: [{ x: 1, y: 2 }],
      physicalActivity: null,
      painFrequency: 'Diario',
      evaScale: 7,
      evaluatedAt: '2026-01-05T12:00:00.000Z',
    };
    const rows = renderEvaluationSnapshot(snapshot, 1, {});
    expect(view(rows)).toMatchObject({
      'Relato del paciente': 'Dolor al levantarse',
      Notas: '—',
      'Frecuencia del dolor': 'Diario',
      'Escala EVA': '7',
      'Mapa de retracciones': 'Con marcas',
    });
    // A new mark changes the row, though it still reads "Con marcas".
    const moved = renderEvaluationSnapshot({ ...snapshot, retractionMap: [{ x: 3, y: 2 }] }, 1, {});
    expect([...changedKeys(moved!, rows)]).toEqual(['retractionMap']);
  });

  it('the consent: signed, and revoked or not', () => {
    expect(view(renderConsentSnapshot({ signedAt: '2026-01-05T12:00:00.000Z', revokedAt: null }, 1, {}))).toMatchObject({
      Revocado: 'No',
    });
    const revoked = view(
      renderConsentSnapshot({ signedAt: '2026-01-05T12:00:00.000Z', revokedAt: '2026-02-05T12:00:00.000Z' }, 1, {}),
    );
    expect(revoked.Revocado).not.toBe('No');
    expect(revoked.Firmado).toMatch(/05\/01\/2026|5\/1\/26/);
  });

  it('the patient event: kind, description and its date as she remembers it', () => {
    const rows = renderPatientEventSnapshot(
      { kind: 'SURGERY', description: 'Rodilla', occurredOn: '2019-05-01', occurredPrecision: 'MONTH', occurredApproximate: true },
      1,
      {},
    );
    expect(view(rows)).toEqual({ Tipo: 'Cirugía', Descripción: 'Rodilla', Fecha: '~mayo de 2019' });
    const undated = renderPatientEventSnapshot(
      { kind: 'OTHER', description: 'Algo', occurredOn: null, occurredPrecision: null, occurredApproximate: false },
      1,
      {},
    );
    expect(view(undated).Fecha).toBe('Sin fecha');
  });

  it('the session: one group per block, named by its episode', () => {
    const block = { preSessionState: null, painScaleBefore: 5, painScaleAfter: null, patientExercises: null, reEvaluationNotes: null };
    const rows = renderSessionSnapshot(
      {
        userId: 'u1',
        sessionType: 'SESSION',
        sessionDate: '2026-11-02T13:00:00.000Z',
        observations: null,
        episodes: [{ episodeId: 'e1', treatment: 'Lumbar', ...block }],
      },
      1,
      { episodeName: () => 'Lumbalgia' },
    );
    expect(rows?.filter((r) => r.group === 'Motivo: Lumbalgia').map((r) => r.label)).toEqual([
      'Estado previo',
      'Tratamiento',
      'Dolor al inicio',
      'Dolor al final',
      'Ejercicios',
      'Reevaluación',
    ]);
    expect(rows?.find((r) => r.label === 'Nota')).toBeUndefined();
  });

  it.each([
    ['patient', renderPatientSnapshot],
    ['episode', renderEpisodeSnapshot],
    ['evaluation', renderEvaluationSnapshot],
    ['consent', renderConsentSnapshot],
    ['patient event', renderPatientEventSnapshot],
    ['session', renderSessionSnapshot],
  ] as const)('the %s: a schema version it does not know, or a snapshot that does not parse, renders as null', (_, render) => {
    expect(render({}, 1, {})).toBeNull();
    expect(render({}, 2, {})).toBeNull();
  });
});

describe('what a version changed', () => {
  const rows = (pairs: [string, string, string?][]): SnapshotRow[] =>
    pairs.map(([key, value, group]) => ({ key, label: key, value, group }));

  it('marks nothing on the first version', () => {
    expect(changedKeys(rows([['a', '1']]), null).size).toBe(0);
  });

  it('marks what differs from the version before, and what is new', () => {
    const before = rows([['a', '1'], ['b', '2']]);
    const now = rows([['a', '1'], ['b', '3'], ['c', '4']]);
    expect([...changedKeys(now, before)]).toEqual(['b', 'c']);
  });

  it('names the groups the version before had and this one does not', () => {
    const before = rows([['x.a', '1', 'Motivo: A'], ['y.a', '1', 'Motivo: B']]);
    const now = rows([['x.a', '1', 'Motivo: A']]);
    expect(removedGroups(now, before)).toEqual(['Motivo: B']);
  });
});
