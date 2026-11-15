import type { Prisma } from '@prisma/client';
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
          // The absent fields are not in the object (Zod invents no key), so
          // the update leaves them as they were.
          create: {
            ...input,
            tenantId: ctx.tenantId,
            patientId,
            episodeId,
          },
          update: input,
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
