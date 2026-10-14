import type { PartialDate } from '@ficha/shared';

export const PATIENT_EVENT_KINDS = ['FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER'] as const;
export type PatientEventKind = (typeof PATIENT_EVENT_KINDS)[number];

// Something the patient lived (#238): an entry of her history ("Antecedentes").
// `occurred` is null when she does not know when.
export interface PatientEvent {
  id: string;
  patientId: string;
  kind: PatientEventKind;
  description: string;
  occurred: PartialDate | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientEventInput {
  kind: PatientEventKind;
  description: string;
  occurred: PartialDate | null;
}
