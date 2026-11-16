import type { RevisionReason } from '@ficha/shared';

export type EncounterType = 'SESSION' | 'NOTE' | 'DISCHARGE';

// One problem the encounter treated: its episode, and everything clinical about
// that problem (#238). A visit that treats the back and an ankle has two.
export interface EncounterBlock {
  episodeId: string;
  preEncounterState: string | null;
  treatment: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  patientExercises: string | null;
  reEvaluationNotes: string | null;
}

// The encounter holds the visit itself; `episodes`, one block per problem it
// treated. An encounter and a discharge treat at least one (a discharge, exactly
// one); a note may treat none. `observations` is the text of a note.
export interface Encounter {
  id: string;
  // Its latest revision: an edit sends the one it loaded, so a stale form gets a
  // 409. 0 for an encounter from before revisions existed.
  version: number;
  patientId: string;
  encounterType: EncounterType;
  encounterDate: string;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
  // When it was annulled (SPEC-clinical-revisions.md §8), or null. Only the
  // patient's list returns an annulled encounter; it counts in nothing.
  annulledAt: string | null;
  episodes: EncounterBlock[];
}

// The block of one episode, if the encounter treated it.
export function blockFor(encounter: Encounter, episodeId: string): EncounterBlock | undefined {
  return encounter.episodes.find((b) => b.episodeId === episodeId);
}

// El POST acepta el cobro junto con la sesión: la API crea todo en una
// transacción (un fallo no deja la sesión a medias).
export interface EncounterPaymentInput {
  packageId?: string | null;
  baseAmountCents: number;
  discountCents?: number;
  notes?: string | null;
}

// A block as sent: a field that does not come is left as it was.
export type EncounterBlockInput = Pick<EncounterBlock, 'episodeId'> &
  Partial<Omit<EncounterBlock, 'episodeId'>>;

export interface EncounterCreateData {
  encounterType: EncounterType;
  encounterDate: string;
  observations?: string | null;
  episodes: EncounterBlockInput[];
  payment?: EncounterPaymentInput;
  /**
   * El turno del que sale esta sesión, cuando se registra desde la agenda.
   * La API lo vincula en la misma transacción y marca el turno como atendido.
   */
  appointmentId?: string | null;
}

// El PATCH no acepta payment: el pago se edita por /api/payments. `episodes`,
// when sent, is the whole set of blocks.
export type EncounterUpdateData = Partial<Omit<EncounterCreateData, 'payment' | 'appointmentId'>> & {
  expectedVersion: number;
  reason: RevisionReason;
  reasonNote?: string;
};
