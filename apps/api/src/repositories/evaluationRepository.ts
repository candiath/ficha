import type { FamilyPainOption, PostureFamilies } from '@ficha/shared';

import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// `retractionMap` viaja como unknown: el port no expone tipos de Prisma y su
// shape real todavía lo define el frontend que lo dibuja. Los campos de la
// sección de familias sí tienen forma declarada en @ficha/shared, así que se
// tipan; la lectura igual llega como unknown porque en la base es JSON y nadie
// garantiza que lo guardado hoy siga siendo válido mañana.
export interface EvaluationDTO {
  id: string;
  patientId: string;
  episodeId: string | null;
  globalPosture: string | null;
  breathingPattern: string | null;
  medicalHistory: string | null;
  reasonForConsultation: string | null;
  notes: string | null;
  morphotype: string | null;
  retractionMap: unknown;
  footEvaluation: string | null;
  breathingPatternDetail: string | null;
  flexibilityNotes: string | null;
  physicalActivity: string | null;
  painAppearanceMoment: string | null;
  painFrequency: string | null;
  familyPainAppearance: unknown;
  familyPainDisappearance: unknown;
  postureFamilies: unknown;
  evaScale: number | null;
  evaluatedAt: string;
  updatedAt: string;
}

// El PUT es un reemplazo completo: un campo ausente se guarda como null
// (los Json con JsonNull), no se preserva el valor anterior.
export interface EvaluationUpsertInput {
  reasonForConsultation?: string | null;
  medicalHistory?: string | null;
  globalPosture?: string | null;
  breathingPattern?: string | null;
  notes?: string | null;
  morphotype?: string | null;
  retractionMap?: unknown;
  footEvaluation?: string | null;
  breathingPatternDetail?: string | null;
  flexibilityNotes?: string | null;
  physicalActivity?: string | null;
  painAppearanceMoment?: string | null;
  painFrequency?: string | null;
  familyPainAppearance?: FamilyPainOption[] | null;
  familyPainDisappearance?: FamilyPainOption[] | null;
  postureFamilies?: PostureFamilies | null;
  evaScale?: number | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// La evaluación inicial es 1:1 con el episodio (episodeId unique). La
// existencia/pertenencia del EPISODIO no se chequea acá: eso es
// episodeRepo.exists, y la ruta lo exige antes de llamar.
export interface EvaluationRepository {
  getByEpisode(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<EvaluationDTO | null>;
  /** Crea o reemplaza; `created` distingue el alta del update (auditoría). */
  upsert(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
    input: EvaluationUpsertInput,
  ): Promise<{ evaluation: EvaluationDTO; created: boolean }>;
}
