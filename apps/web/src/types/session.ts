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

// El POST acepta el cobro y las técnicas junto con la sesión: la API crea
// todo en una transacción (un fallo no deja la sesión a medias).
export interface SessionPaymentInput {
  packageId?: string | null;
  baseAmount: number;
  discount?: number;
  notes?: string | null;
}

export interface SessionTechniqueInput {
  techniqueId: string;
  bodyRegionId?: string | null;
  muscularChainId?: string | null;
  variantNotes?: string | null;
}

export type SessionCreateData = Omit<Session, 'id' | 'patientId' | 'createdAt' | 'updatedAt'> & {
  payment?: SessionPaymentInput;
  techniques?: SessionTechniqueInput[];
};

// El PATCH no acepta payment/techniques: el pago se edita por /api/payments
// y las técnicas por su bulkReplace.
export type SessionUpdateData = Partial<Omit<SessionCreateData, 'payment' | 'techniques'>>;
