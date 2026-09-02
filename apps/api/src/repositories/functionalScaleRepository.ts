import type { ScaleType } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// El listado no carga las respuestas (el mapa {pregunta: valor} solo se
// necesita en el detalle).
export interface FunctionalScaleSummaryDTO {
  id: string;
  scaleType: ScaleType;
  score: number;
  interpretation: string;
  appliedAt: string;
  createdAt: string;
}

export interface FunctionalScaleDTO extends FunctionalScaleSummaryDTO {
  patientId: string;
  episodeId: string | null;
  responses: unknown;
}

// score e interpretation llegan calculados: el scoring ODI/NDI es dominio
// puro y vive en la ruta.
export interface FunctionalScaleCreateInput {
  scaleType: ScaleType;
  responses: Record<string, number>;
  score: number;
  interpretation: string;
  appliedAt?: Date;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Como episodios: todo método pide patientId, y una escala de otro paciente
// cuenta como inexistente. La vigencia del paciente la exige la ruta con
// patientRepo.exists.
export interface FunctionalScaleRepository {
  listByPatient(ctx: TenantContext, patientId: string): Promise<FunctionalScaleSummaryDTO[]>;
  /** null si la escala no existe o es de otro paciente. */
  getById(ctx: TenantContext, patientId: string, id: string): Promise<FunctionalScaleDTO | null>;
  create(
    ctx: TenantContext,
    patientId: string,
    input: FunctionalScaleCreateInput,
  ): Promise<FunctionalScaleDTO>;
  /** false si no había escala del paciente que borrar. */
  delete(ctx: TenantContext, patientId: string, id: string): Promise<boolean>;
}
