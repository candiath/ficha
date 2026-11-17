import type { PartialDate } from '@ficha/shared';

export const PATIENT_ANTECEDENT_KINDS = ['FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER'] as const;
export type PatientAntecedentKind = (typeof PATIENT_ANTECEDENT_KINDS)[number];

// Something the patient lived (#238): an entry of her history ("Antecedentes").
// `occurred` is null when she does not know when.
export interface PatientAntecedent {
  id: string;
  patientId: string;
  kind: PatientAntecedentKind;
  description: string;
  occurred: PartialDate | null;
  createdAt: string;
  updatedAt: string;
  // The latest version (0: none yet).
  version: number;
  // When it was annulled (SPEC-clinical-revisions.md §8), or null.
  annulledAt: string | null;
}

export interface PatientAntecedentInput {
  kind: PatientAntecedentKind;
  description: string;
  occurred: PartialDate | null;
}
