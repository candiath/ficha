import type { DocumentType, RevisionReason } from '@ficha/shared';

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  // "firstName lastName", built by the API for display.
  fullName: string;
  // A day, YYYY-MM-DD, with no time zone (lib/calendarDate.ts).
  birthDate: string | null;
  sex: 'MALE' | 'FEMALE' | 'OTHER' | null;
  // The document that identifies her: both or neither. The number as the API
  // stores it (a DNI as its digits).
  documentType: DocumentType | null;
  documentNumber: string | null;
  phone: string | null;
  occupation: string | null;
  referringDoctor: string | null;
  insuranceName: string | null;
  insuranceNumber: string | null;
  insurancePlan: string | null;
  createdAt: string;
  updatedAt: string;
  // The latest version of the record (0: none yet). Only the record carries
  // it, not the list: an edit form reads the record.
  version?: number;
}

export interface PatientFormData {
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  sex?: 'MALE' | 'FEMALE' | 'OTHER' | null;
  // Sent together, or neither (the API refuses one without the other).
  documentType?: DocumentType | null;
  documentNumber?: string | null;
  phone?: string | null;
  occupation?: string | null;
  referringDoctor?: string | null;
  insuranceName?: string | null;
  insuranceNumber?: string | null;
  insurancePlan?: string | null;
}

// The body of an annulment: a reason, always, and an optional note.
export interface AnnulData {
  reason: RevisionReason;
  reasonNote?: string | null;
}

// A deleted patient, in the list to restore one (GET /api/patients/deleted).
export interface DeletedPatient {
  id: string;
  fullName: string;
  deletedAt: string;
}

// An edit of the record: the version it was made over, and why
// (SPEC-clinical-revisions.md §4, §5).

export interface RevisionMeta {
  expectedVersion?: number;
  reason?: RevisionReason;
  reasonNote?: string | null;
}
