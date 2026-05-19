export interface InitialEvaluation {
  id: string;
  patientId: string;
  reasonForConsultation: string | null;
  medicalHistory: string | null;
  globalPosture: string | null;
  breathingPattern: string | null;
  notes: string | null;
  morphotype: string | null;
  retractionMap: BodyMarker[] | null;
  footEvaluation: string | null;
  breathingPatternDetail: string | null;
  flexibilityNotes: string | null;
  evaluatedAt: string;
  updatedAt: string;
}

export interface BodyMarker {
  id: string;
  x: number;
  y: number;
  label: string;
  severity: 'low' | 'medium' | 'high';
  notes: string;
  view: 'front' | 'back' | 'left' | 'right';
}

export type EvaluationUpsertData = Omit<InitialEvaluation, 'id' | 'patientId' | 'evaluatedAt' | 'updatedAt'>;
