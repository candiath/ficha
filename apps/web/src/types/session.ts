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

export type SessionCreateData = Omit<Session, 'id' | 'patientId' | 'createdAt' | 'updatedAt'>;
export type SessionUpdateData = Partial<SessionCreateData>;
