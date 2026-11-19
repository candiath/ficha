import type { DatePrecision, DocumentType, EpisodeStatus, PatientAntecedentKind, Sex } from '@prisma/client';
import type {
  ConsentSnapshotV1,
  EpisodeSnapshotV1,
  EvaluationSnapshotV1,
  PatientAntecedentSnapshotV1,
  PatientSnapshotV2,
} from '@ficha/shared';

// The canonical projections of the patient, the episode, the initial
// evaluation, the informed consent and the patient antecedent
// (SPEC-clinical-revisions.md §3): the one mapping from each row to its
// snapshot, used to write a version and to decide whether a write changed
// anything. The encounter's is in encounterSnapshot.ts.
// tests/historyProjectionCoverage.test.ts holds every other column to a decision.

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;
// A DATE column: its day, YYYY-MM-DD.
export const dayOrNull = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

export const patientSnapshotSelect = {
  firstName: true,
  lastName: true,
  birthDate: true,
  sex: true,
  documentType: true,
  documentNumber: true,
  occupation: true,
  referringDoctor: true,
} as const;

export function patientSnapshot(p: {
  firstName: string;
  lastName: string;
  birthDate: Date | null;
  sex: Sex | null;
  documentType: DocumentType | null;
  documentNumber: string | null;
  occupation: string | null;
  referringDoctor: string | null;
}): PatientSnapshotV2 {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: dayOrNull(p.birthDate),
    sex: p.sex,
    documentType: p.documentType,
    documentNumber: p.documentNumber,
    occupation: p.occupation,
    referringDoctor: p.referringDoctor,
  };
}

export const episodeSnapshotSelect = { status: true, mainComplaint: true, openedAt: true, closedAt: true } as const;

export function episodeSnapshot(e: {
  status: EpisodeStatus;
  mainComplaint: string | null;
  openedAt: Date;
  closedAt: Date | null;
}): EpisodeSnapshotV1 {
  return {
    status: e.status,
    mainComplaint: e.mainComplaint,
    openedAt: iso(e.openedAt),
    closedAt: isoOrNull(e.closedAt),
  };
}

export function evaluationSnapshot(e: {
  patientNarrative: string | null;
  otherHistory: string | null;
  notes: string | null;
  physicalActivity: string | null;
  painFrequency: string | null;
  painScale: number | null;
  evaluatedAt: Date;
}): EvaluationSnapshotV1 {
  return {
    patientNarrative: e.patientNarrative,
    otherHistory: e.otherHistory,
    notes: e.notes,
    physicalActivity: e.physicalActivity,
    painFrequency: e.painFrequency,
    painScale: e.painScale,
    evaluatedAt: iso(e.evaluatedAt),
  };
}

export function consentSnapshot(c: { signedAt: Date; revokedAt: Date | null }): ConsentSnapshotV1 {
  return { signedAt: iso(c.signedAt), revokedAt: isoOrNull(c.revokedAt) };
}

export function patientAntecedentSnapshot(e: {
  kind: PatientAntecedentKind;
  description: string;
  occurredOn: Date | null;
  occurredPrecision: DatePrecision | null;
  occurredApproximate: boolean;
}): PatientAntecedentSnapshotV1 {
  return {
    kind: e.kind,
    description: e.description,
    // A @db.Date column: its day, without the midnight Prisma reads it at.
    occurredOn: dayOrNull(e.occurredOn),
    occurredPrecision: e.occurredPrecision,
    occurredApproximate: e.occurredApproximate,
  };
}
