import type { RevisionMeta } from './patient';

export interface InitialEvaluation {
  id: string;
  patientId: string;
  // "Relato del paciente": what happened and how it started.
  patientNarrative: string | null;
  // "Otros antecedentes": what the patient's history list does not hold.
  otherHistory: string | null;
  notes: string | null;
  retractionMap: BodyMarker[] | null;
  physicalActivity: string | null;
  painFrequency: string | null;
  evaScale: number | null;
  evaluatedAt: string;
  updatedAt: string;
  // The latest version (0: none yet).
  version: number;
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

// The first save sends expectedVersion 0 and no reason; a correction, both.
export type EvaluationUpsertData = Omit<InitialEvaluation, 'id' | 'patientId' | 'evaluatedAt' | 'updatedAt' | 'version'> &
  RevisionMeta;
