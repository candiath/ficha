import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  EvaluationDTO,
  EvaluationRepository,
  EvaluationUpsertInput,
} from '../evaluationRepository';

const evaluationSelect = {
  id: true,
  patientId: true,
  episodeId: true,
  globalPosture: true,
  breathingPattern: true,
  medicalHistory: true,
  reasonForConsultation: true,
  notes: true,
  morphotype: true,
  retractionMap: true,
  footEvaluation: true,
  breathingPatternDetail: true,
  flexibilityNotes: true,
  physicalActivity: true,
  painAppearanceMoment: true,
  painFrequency: true,
  familyPainAppearance: true,
  familyPainDisappearance: true,
  postureFamilies: true,
  evaScale: true,
  evaluatedAt: true,
  updatedAt: true,
} as const;

type EvaluationRow = Omit<EvaluationDTO, 'evaluatedAt' | 'updatedAt'> & {
  evaluatedAt: Date;
  updatedAt: Date;
};

function toDTO(row: EvaluationRow): EvaluationDTO {
  return {
    ...row,
    evaluatedAt: row.evaluatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Un Json de Prisma no acepta null de JS a secas: JsonNull es el null SQL.
// El ?? también convierte `undefined` (campo ausente del PUT) en JsonNull:
// el PUT es reemplazo completo, no merge.
function jsonFields(input: EvaluationUpsertInput) {
  return {
    retractionMap: (input.retractionMap as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    familyPainAppearance:
      (input.familyPainAppearance as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    familyPainDisappearance:
      (input.familyPainDisappearance as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    postureFamilies: input.postureFamilies ?? Prisma.JsonNull,
  };
}

export const prismaEvaluationRepository: EvaluationRepository = {
  async getByEpisode(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
  ): Promise<EvaluationDTO | null> {
    const db = forTenant(ctx);
    // patientId en el where como cinturón: episodeId ya es unique y la ruta
    // valida el episodio, pero así la fila de otro paciente ni se lee.
    const row = await db.initialEvaluation.findFirst({
      where: { episodeId, patientId },
      select: evaluationSelect,
    });
    return row ? toDTO(row) : null;
  },

  async upsert(
    ctx: TenantContext,
    patientId: string,
    episodeId: string,
    input: EvaluationUpsertInput,
  ): Promise<{ evaluation: EvaluationDTO; created: boolean }> {
    const db = forTenant(ctx);
    const existing = await db.initialEvaluation.findUnique({
      where: { episodeId },
      select: { id: true },
    });

    const row = await db.initialEvaluation.upsert({
      where: { episodeId },
      create: {
        ...input,
        ...jsonFields(input),
        patientId,
        episodeId,
      },
      update: {
        ...input,
        ...jsonFields(input),
      },
      select: evaluationSelect,
    });

    return { evaluation: toDTO(row), created: existing === null };
  },
};
