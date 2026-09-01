export type SessionType = 'SESSION' | 'NOTE' | 'DISCHARGE';

export interface Session {
  id: string;
  patientId: string;
  // Una sesión puede abordar varios episodios (motivos) a la vez.
  episodeIds: string[];
  sessionType: SessionType;
  sessionDate: string;
  preSesionState: string | null;
  reEvaluationNotes: string | null;
  patientResponse: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
}

// El POST acepta el cobro junto con la sesión: la API crea todo en una
// transacción (un fallo no deja la sesión a medias).
export interface SessionPaymentInput {
  packageId?: string | null;
  baseAmount: number;
  discount?: number;
  notes?: string | null;
}

export type SessionCreateData = Omit<Session, 'id' | 'patientId' | 'createdAt' | 'updatedAt'> & {
  payment?: SessionPaymentInput;
};

// El PATCH no acepta payment: el pago se edita por /api/payments.
export type SessionUpdateData = Partial<Omit<SessionCreateData, 'payment'>>;
