import { Prisma } from '@prisma/client';
import { AUDIT_EVALUATION_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  EvaluationAuditBuilder,
  EvaluationAuditField,
  EvaluationDTO,
  EvaluationEditMeta,
  EvaluationRepository,
  EvaluationUpsertInput,
  EvaluationUpsertResult,
} from '../evaluationRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';
import { recordRevision, Rollback, unlessRolledBack } from './recordRevision';
import { evaluationSnapshot } from './clinicalSnapshots';

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
  // The latest version; none is version 0.
  revisions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} as const;

type EvaluationRow = Prisma.InitialEvaluationGetPayload<{ select: typeof evaluationSelect }>;

const AUDIT_FIELDS = Object.keys(AUDIT_EVALUATION_FIELDS) as EvaluationAuditField[];

function toDTO({ revisions, ...row }: EvaluationRow): EvaluationDTO {
  return {
    ...row,
    version: revisions[0]?.version ?? 0,
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
    { expectedVersion, reason, reasonNote, ...input }: EvaluationUpsertInput & EvaluationEditMeta,
    audit: EvaluationAuditBuilder,
  ): Promise<EvaluationUpsertResult> {
    const db = forTenant(ctx);
    // The audit row and the version go in the same transaction as the write
    // (#188, SPEC-clinical-revisions.md §5).
    return unlessRolledBack(
      db.$transaction(async (tx): Promise<EvaluationUpsertResult> => {
        // The episode is locked, not the evaluation: before the first one there
        // is no row to lock, and two first evaluations would both write version
        // 1. Then read: a concurrent save waits, and reads what this one wrote.
        await lockRow(tx, 'clinical_episodes', episodeId, ctx.tenantId);
        const existing = await tx.initialEvaluation.findUnique({
          where: { episodeId, tenantId: ctx.tenantId },
          select: evaluationSelect,
        });
        const before = existing ? toDTO(existing) : null;
        const version = before?.version ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== version) return { ok: false, reason: 'stale' };

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
        const evaluation = { ...toDTO(row), version: version + 1 };

        let changed: ReturnType<typeof nonEmpty<EvaluationAuditField>> = null;
        if (before) {
          // Compared after the write, with the same select: a save that changed
          // nothing, or a correction with no reason, is rolled back whole.
          changed = nonEmpty(changedFields(before, evaluation, AUDIT_FIELDS));
          if (!changed) throw new Rollback<EvaluationUpsertResult>({ ok: true, evaluation: before, created: false });
          if (reason === undefined) throw new Rollback<EvaluationUpsertResult>({ ok: false, reason: 'reason_required' });
        }
        const result = { evaluation, created: before === null };
        const auditLogId = await recordAudit(tx, ctx, audit(result, changed));
        await recordRevision(tx, ctx, 'evaluation_revisions', {
          aggregateId: row.id,
          patientId,
          version: evaluation.version,
          auditLogId,
          snapshot: evaluationSnapshot(row),
          reasonNote: before ? reasonNote : undefined,
        });
        return { ok: true, ...result };
      }),
    );
  },
};
