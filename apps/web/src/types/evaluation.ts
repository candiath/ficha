export interface InitialEvaluation {
  id: string;
  patientId: string;
  reasonForConsultation: string | null;
  medicalHistory: string | null;
  globalPosture: string | null;
  breathingPattern: string | null;
  notes: string | null;
  evaluatedAt: string;
  updatedAt: string;
}

export type EvaluationUpsertData = Omit<InitialEvaluation, 'id' | 'patientId' | 'evaluatedAt' | 'updatedAt'>;
