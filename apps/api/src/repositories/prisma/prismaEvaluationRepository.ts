import { Prisma } from '@prisma/client';
import { AUDIT_EVALUATION_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  EvaluationAuditBuilder,
  EvaluationAuditField,
  EvaluationDTO,
  EvaluationRepository,
  EvaluationUpsertInput,
  EvaluationUpsertResult,
} from '../evaluationRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';

const evaluationSelect = {
  id: true,
  patientId: true,
  episodeId: true,
  patientNarrative: true,
  otherHistory: true,
  notes: true,
  retractionMap: true,
  physicalActivity: true,
  painFrequency: true,
  evaScale: true,
  evaluatedAt: true,
  updatedAt: true,
} as const;

type EvaluationRow = Omit<EvaluationDTO, 'evaluatedAt' | 'updatedAt'> & {
  evaluatedAt: Date;
  updatedAt: Date;
};

const AUDIT_FIELDS = Object.keys(AUDIT_EVALUATION_FIELDS) as EvaluationAuditField[];

function toDTO(row: EvaluationRow): EvaluationDTO {
  return {
    ...row,
    evaluatedAt: row.evaluatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const JSON_FIELDS = ['retractionMap'] as const satisfies readonly (keyof EvaluationUpsertInput)[];

// Los campos que no son JSON viajan tal cual: son escalares que Prisma ya sabe
// escribir, y los ausentes no están en el objeto (Zod no inventa la clave), así
// que el update no los toca. Las columnas JSON se sacan de acá porque las arma
// jsonFields con su propio null.
type ScalarFields = Omit<EvaluationUpsertInput, (typeof JSON_FIELDS)[number]>;

function scalarFields(input: EvaluationUpsertInput): ScalarFields {
  const scalars: EvaluationUpsertInput = { ...input };
  for (const field of JSON_FIELDS) delete scalars[field];
  return scalars;
}

// Las columnas JSON, con la misma regla que el resto de la API: el campo que
// no viene no se toca, el que viene en null se borra.
//
// Dos cosas obligan a armarlas a mano en vez de dejarlas en el spread del
// input. Una, que un Json de Prisma no acepta el null de JS: el null SQL se
// escribe con JsonNull. La otra, que la clave tiene que quedar AUSENTE cuando
// el campo no vino — antes se completaba con `?? JsonNull`, y así un PUT que
// no mencionaba un campo JSON lo borraba (#161).
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
    audit: EvaluationAuditBuilder,
  ): Promise<EvaluationUpsertResult> {
    const db = forTenant(ctx);
    // The audit row goes in the same transaction as the write (#188).
    return db.$transaction(async (tx) => {
      // Locked and read first, to record which fields an update changed
      // (#186): a concurrent edit waits for this one.
      await lockRow(tx, 'initial_evaluations', episodeId, ctx.tenantId);
      const existing = await tx.initialEvaluation.findUnique({
        where: { episodeId, tenantId: ctx.tenantId },
        select: evaluationSelect,
      });

      const row = await tx.initialEvaluation.upsert({
        where: { episodeId, tenantId: ctx.tenantId },
        create: {
          ...scalarFields(input),
          ...jsonFields(input),
          tenantId: ctx.tenantId,
          patientId,
          episodeId,
        },
        update: {
          ...scalarFields(input),
          ...jsonFields(input),
        },
        select: evaluationSelect,
      });

      const result = { evaluation: toDTO(row), created: existing === null };
      if (existing === null) {
        await recordAudit(tx, ctx, audit(result, null));
      } else {
        const changed = nonEmpty(changedFields(toDTO(existing), result.evaluation, AUDIT_FIELDS));
        if (changed) await recordAudit(tx, ctx, audit(result, changed));
      }
      return result;
    });
  },
};
