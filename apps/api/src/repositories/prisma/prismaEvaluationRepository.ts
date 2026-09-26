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

const JSON_FIELDS = [
  'retractionMap',
  'familyPainAppearance',
  'familyPainDisappearance',
  'postureFamilies',
] as const satisfies readonly (keyof EvaluationUpsertInput)[];

// Los campos que no son JSON viajan tal cual: son escalares que Prisma ya sabe
// escribir, y los ausentes no están en el objeto (Zod no inventa la clave), así
// que el update no los toca. Las cuatro columnas JSON se sacan de acá porque
// las arma jsonFields con su propio null.
type ScalarFields = Omit<EvaluationUpsertInput, (typeof JSON_FIELDS)[number]>;

function scalarFields(input: EvaluationUpsertInput): ScalarFields {
  const scalars: EvaluationUpsertInput = { ...input };
  for (const field of JSON_FIELDS) delete scalars[field];
  return scalars;
}

// Las cuatro columnas JSON, con la misma regla que el resto de la API: el
// campo que no viene no se toca, el que viene en null se borra.
//
// Dos cosas obligan a armarlas a mano en vez de dejarlas en el spread del
// input. Una, que un Json de Prisma no acepta el null de JS: el null SQL se
// escribe con JsonNull. La otra, que la clave tiene que quedar AUSENTE cuando
// el campo no vino — antes se completaba con `?? JsonNull`, y así un PUT que
// no mencionaba la grilla la borraba (#161).
function jsonFields(input: EvaluationUpsertInput) {
  const data: Record<string, Prisma.InputJsonValue | typeof Prisma.JsonNull> = {};

  for (const field of JSON_FIELDS) {
    const value = input[field];
    // undefined es "no vino": un body JSON no puede transportar undefined, así
    // que no hay forma de que signifique otra cosa.
    if (value === undefined) continue;
    data[field] = value === null ? Prisma.JsonNull : value;
  }

  return data;
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
        ...scalarFields(input),
        ...jsonFields(input),
        patientId,
        episodeId,
      },
      update: {
        ...scalarFields(input),
        ...jsonFields(input),
      },
      select: evaluationSelect,
    });

    return { evaluation: toDTO(row), created: existing === null };
  },
};
