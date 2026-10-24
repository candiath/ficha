export type SessionType = 'SESSION' | 'NOTE' | 'DISCHARGE';

// One problem the session treated: its episode, and everything clinical about
// that problem (#238). A visit that treats the back and an ankle has two.
export interface SessionEpisodeBlock {
  episodeId: string;
  preSessionState: string | null;
  treatment: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  patientExercises: string | null;
  reEvaluationNotes: string | null;
}

// The session holds the visit itself; `episodes`, one block per problem it
// treated. A session and a discharge treat at least one (a discharge, exactly
// one); a note may treat none. `observations` is the text of a note.
export interface Session {
  id: string;
  patientId: string;
  sessionType: SessionType;
  sessionDate: string;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
  episodes: SessionEpisodeBlock[];
}

// The block of one episode, if the session treated it.
export function blockFor(session: Session, episodeId: string): SessionEpisodeBlock | undefined {
  return session.episodes.find((b) => b.episodeId === episodeId);
}

// El POST acepta el cobro junto con la sesión: la API crea todo en una
// transacción (un fallo no deja la sesión a medias).
export interface SessionPaymentInput {
  packageId?: string | null;
  baseAmountCents: number;
  discountCents?: number;
  notes?: string | null;
}

// A block as sent: a field that does not come is left as it was.
export type SessionEpisodeBlockInput = Pick<SessionEpisodeBlock, 'episodeId'> &
  Partial<Omit<SessionEpisodeBlock, 'episodeId'>>;

export interface SessionCreateData {
  sessionType: SessionType;
  sessionDate: string;
  observations?: string | null;
  episodes: SessionEpisodeBlockInput[];
  payment?: SessionPaymentInput;
  /**
   * El turno del que sale esta sesión, cuando se registra desde la agenda.
   * La API lo vincula en la misma transacción y marca el turno como atendido.
   */
  appointmentId?: string | null;
}

// El PATCH no acepta payment: el pago se edita por /api/payments. `episodes`,
// when sent, is the whole set of blocks.
export type SessionUpdateData = Partial<Omit<SessionCreateData, 'payment' | 'appointmentId'>>;
