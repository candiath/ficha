import type { AUDIT_EVALUATION_FIELDS } from '@ficha/shared';

import type { TenantContext } from './types';
import type { AuditEntry } from './auditLogRepository';

export interface EvaluationUpsertResult {
  evaluation: EvaluationDTO;
  created: boolean;
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

// `retractionMap` viaja como unknown: el port no expone tipos de Prisma y su
// shape real todavía lo define el frontend que lo dibuja.
export interface EvaluationDTO {
  id: string;
  patientId: string;
  episodeId: string | null;
  patientNarrative: string | null;
  otherHistory: string | null;
  notes: string | null;
  retractionMap: unknown;
  physicalActivity: string | null;
  painFrequency: string | null;
  evaScale: number | null;
  evaluatedAt: string;
  updatedAt: string;
}

// El PUT actualiza lo que viene y deja el resto como estaba, con la regla que
// vale en toda la API (lib/validation.ts): el campo ausente no se toca, el que
// viene en null —o en "" desde un formulario— se borra.
//
// Antes era mitad y mitad: los escalares ausentes se preservaban y los Json
// ausentes se borraban, así que el mismo request conservaba `notes` y vaciaba
// lo guardado en JSON (#161).
export interface EvaluationUpsertInput {
  patientNarrative?: string | null;
  otherHistory?: string | null;
  notes?: string | null;
  retractionMap?: unknown;
  physicalActivity?: string | null;
  painFrequency?: string | null;
  evaScale?: number | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// La evaluación inicial es 1:1 con el episodio (episodeId unique). La
// existencia/pertenencia del EPISODIO no se chequea acá: eso es
// episodeRepo.exists, y la ruta lo exige antes de llamar.
export type EvaluationAuditField = keyof typeof AUDIT_EVALUATION_FIELDS;

export type EvaluationAuditBuilder = (
  result: EvaluationUpsertResult,
  changedFields: [EvaluationAuditField, ...EvaluationAuditField[]] | null,
) => AuditEntry;

export interface EvaluationRepository {
  getByEpisode(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<EvaluationDTO | null>;
  /**
   * Crea o reemplaza; `created` distingue el alta del update (auditoría). The
   * audit builder gets the changed fields' names on an update (null on a
   * create); an update that changed nothing records no audit row.
   */
  upsert(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
    input: EvaluationUpsertInput,
    audit: EvaluationAuditBuilder,
  ): Promise<EvaluationUpsertResult>;
}
