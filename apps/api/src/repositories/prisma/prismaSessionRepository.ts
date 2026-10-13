import { Prisma } from '@prisma/client';
import { AUDIT_SESSION_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { settle } from '../../lib/paymentSettlement';
import type { TenantContext } from '../types';
import type { SessionType } from '@prisma/client';
import type {
  SessionAuditField,
  SessionCreateInput,
  SessionCreateResult,
  SessionDTO,
  SessionEpisodeBlockDTO,
  SessionEpisodeBlockInput,
  SessionEpisodeRuleViolation,
  SessionRepository,
  SessionUpdateInput,
  SessionUpdateResult,
  SessionIndexItemDTO,
} from '../sessionRepository';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../auditLogRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';

// Política del repositorio: todo método opera sobre sesiones vigentes. Una
// sesión borrada no se lista, no se lee y no se edita — el mismo criterio que
// patientRepository aplica a los pacientes.
const VIGENTE = { deletedAt: null } as const;

// Se lanza dentro de la transacción para que Prisma la revierta, y se
// convierte en un resultado justo afuera. Es la forma de abortar una
// transacción interactiva sin que el error salga como un 500.
class TurnoYaRegistrado extends Error {}

const blockSelect = {
  episodeId: true,
  painScaleBefore: true,
  painScaleAfter: true,
  patientExercises: true,
  reEvaluationNotes: true,
} as const;

const sessionSelect = {
  id: true,
  patientId: true,
  sessionType: true,
  sessionDate: true,
  preSessionState: true,
  observations: true,
  createdAt: true,
  updatedAt: true,
  // orderBy explícito: sin él, una sesión con varios episodios devuelve los
  // bloques en orden indefinido (Postgres no garantiza ninguno sin ORDER BY)
  // y el mismo GET puede responder distinto entre llamadas. Por episodeId:
  // los ids son UUIDv7, así que es el orden en que se abrieron los episodios.
  episodes: { select: blockSelect, orderBy: { episodeId: 'asc' } },
} as const;

// The fields of a block, without its episode.
type BlockField = Exclude<keyof SessionEpisodeBlockDTO, 'episodeId'>;

const EMPTY_BLOCK: Record<BlockField, null> = {
  painScaleBefore: null,
  painScaleAfter: null,
  patientExercises: null,
  reEvaluationNotes: null,
};

// The clinic-wide index (GET /api/sessions): who and when, nothing clinical
// (#186, SPEC-list-minimization.md §1). Selected column by column, so clinical
// text never leaves the database for a list that spans patients.
const sessionIndexSelect = {
  id: true,
  sessionType: true,
  sessionDate: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { id: true, fullName: true } },
} as const;

type SessionRow = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;

type SessionIndexRow = Prisma.SessionGetPayload<{ select: typeof sessionIndexSelect }>;

const AUDIT_FIELDS = Object.keys(AUDIT_SESSION_FIELDS) as SessionAuditField[];

function toDTO(row: SessionRow): SessionDTO {
  return {
    ...row,
    sessionDate: row.sessionDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The session as the audit compares it: one value per catalog field. A block
// field becomes the list of (episode, value) pairs that hold a value, so adding
// an empty block changes only episodeIds, and a value that changes in any
// block changes its field.
function auditView(s: SessionDTO): Record<SessionAuditField, unknown> {
  const valuesOf = (field: BlockField) =>
    s.episodes.filter((b) => b[field] !== null).map((b) => [b.episodeId, b[field]]);
  return {
    sessionType: s.sessionType,
    sessionDate: s.sessionDate,
    preSessionState: s.preSessionState,
    observations: s.observations,
    episodeIds: s.episodes.map((b) => b.episodeId),
    painScaleBefore: valuesOf('painScaleBefore'),
    painScaleAfter: valuesOf('painScaleAfter'),
    patientExercises: valuesOf('patientExercises'),
    reEvaluationNotes: valuesOf('reEvaluationNotes'),
  };
}

function episodeRuleViolation(
  sessionType: SessionType,
  episodeCount: number,
): SessionEpisodeRuleViolation | null {
  if (sessionType === 'DISCHARGE' && episodeCount !== 1) return 'discharge_needs_one_episode';
  if (sessionType === 'SESSION' && episodeCount === 0) return 'needs_episode';
  return null;
}

// The fields a block input brings; one that does not come is left out.
function blockData(block: SessionEpisodeBlockInput) {
  return {
    ...(block.painScaleBefore !== undefined && { painScaleBefore: block.painScaleBefore }),
    ...(block.painScaleAfter !== undefined && { painScaleAfter: block.painScaleAfter }),
    ...(block.patientExercises !== undefined && { patientExercises: block.patientExercises }),
    ...(block.reEvaluationNotes !== undefined && { reEvaluationNotes: block.reEvaluationNotes }),
  };
}

// The blocks a session ends up with: each one in the input, over what that
// block held before (or empty, for a new one).
function mergeBlocks(
  before: SessionEpisodeBlockDTO[],
  input: SessionEpisodeBlockInput[],
): SessionEpisodeBlockDTO[] {
  const previous = new Map(before.map((b) => [b.episodeId, b]));
  return input.map((block) => ({
    ...EMPTY_BLOCK,
    ...previous.get(block.episodeId),
    ...blockData(block),
    episodeId: block.episodeId,
  }));
}

function toIndexItemDTO(row: SessionIndexRow): SessionIndexItemDTO {
  return {
    ...row,
    sessionDate: row.sessionDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Los campos propios de la sesión, sin los bloques ni las relaciones.
function sessionData(input: Partial<SessionCreateInput>) {
  return {
    ...(input.sessionType !== undefined && { sessionType: input.sessionType }),
    ...(input.sessionDate !== undefined && { sessionDate: input.sessionDate }),
    ...(input.preSessionState !== undefined && { preSessionState: input.preSessionState }),
    ...(input.observations !== undefined && { observations: input.observations }),
  };
}

export const prismaSessionRepository: SessionRepository = {
  async listByPatient(
    ctx: TenantContext,
    patientId: string,
    filters?: { episodeId?: string },
  ): Promise<SessionDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.session.findMany({
      where: {
        ...VIGENTE,
        patientId,
        ...(filters?.episodeId ? { episodes: { some: { episodeId: filters.episodeId } } } : {}),
      },
      orderBy: { sessionDate: 'desc' },
      select: sessionSelect,
    });
    return rows.map(toDTO);
  },

  async getById(ctx: TenantContext, patientId: string, id: string): Promise<SessionDTO | null> {
    const db = forTenant(ctx);
    const row = await db.session.findFirst({
      where: { ...VIGENTE, id, patientId },
      select: sessionSelect,
    });
    return row ? toDTO(row) : null;
  },

  async listIndexForTenant(ctx: TenantContext): Promise<SessionIndexItemDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.session.findMany({
      where: VIGENTE,
      orderBy: { sessionDate: 'desc' },
      select: sessionIndexSelect,
    });
    return rows.map(toIndexItemDTO);
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: SessionCreateInput,
    audit: AuditBuilder<SessionDTO>,
  ): Promise<SessionCreateResult> {
    const db = forTenant(ctx);
    const { episodes, payment, appointmentId } = input;

    const violation = episodeRuleViolation(input.sessionType, episodes.length);
    if (violation) return { ok: false, reason: violation };

    // Todo lo que dispara el registro de una sesión es atómico: si el pago o
    // el cierre de episodios fallan, no queda una sesión a medias (sin pago
    // no aparece en Cobros, y el reintento la duplicaba).
    //
    // Nota multi-tenant: el `tx` de una transacción interactiva NO está
    // reescrito por el tipo TenantScopedClient (igual que upsert; ver #55),
    // así que sus create/updateMany siguen exigiendo/aceptando tenantId a
    // nivel de tipo. Lo dejamos explícito: es lo que el tipo pide y, en el
    // updateMany de episodios, el filtro de seguridad real. En runtime el tx
    // además arrastra la extension (el objeto es el cliente extendido), como
    // defensa en profundidad.
    const session = await db.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          ...sessionData(input),
          sessionType: input.sessionType,
          sessionDate: input.sessionDate,
          patientId,
          tenantId: ctx.tenantId,
          // La sesión queda atribuida al usuario autenticado que la registra.
          userId: ctx.userId,
        },
        select: { id: true },
      });

      // One block per episode the session treated. Its keys name the
      // session's clinic and patient, so the database refuses an episode of
      // another one.
      await tx.sessionEpisode.createMany({
        data: episodes.map((block) => ({
          ...EMPTY_BLOCK,
          ...blockData(block),
          tenantId: ctx.tenantId,
          patientId,
          sessionId: created.id,
          episodeId: block.episodeId,
        })),
      });

      if (payment) {
        // settle() decide monto y estado juntos: un cobro que da 0 nace
        // WAIVED, porque no hay ninguna deuda que reclamar.
        const { finalAmount, status } = settle(payment.baseAmount, payment.discount);
        await tx.payment.create({
          data: {
            tenantId: ctx.tenantId,
            patientId,
            sessionId: created.id,
            packageId: payment.packageId ?? null,
            baseAmount: payment.baseAmount,
            discount: payment.discount,
            finalAmount,
            status,
            notes: payment.notes ?? null,
          },
        });
      }

      // Cierre automático del episodio al registrar el alta: un alta cierra
      // exactamente uno. Dentro de la transacción: antes era fire-and-forget
      // y un fallo dejaba el alta registrada con el episodio todavía abierto.
      if (input.sessionType === 'DISCHARGE') {
        await tx.clinicalEpisode.updateMany({
          where: { id: { in: episodes.map((b) => b.episodeId) }, tenantId: ctx.tenantId },
          data: { status: 'DISCHARGED', closedAt: new Date() },
        });
      }

      // El vínculo con el turno va en la MISMA transacción: si la sesión se
      // crea y el vínculo no, el turno queda pidiendo que se registre algo
      // que ya se registró. La condición viaja en el where —sessionId null—
      // así que dos intentos simultáneos no pueden producir dos sesiones para
      // la misma visita; el segundo no matchea y revierte todo.
      if (appointmentId) {
        const { count } = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            tenantId: ctx.tenantId,
            patientId,
            sessionId: null,
          },
          data: { sessionId: created.id, status: 'COMPLETED', cancelledAt: null },
        });
        if (count === 0) throw new TurnoYaRegistrado();
      }

      const dto = toDTO(
        await tx.session.findUniqueOrThrow({
          where: { id: created.id, tenantId: ctx.tenantId },
          select: sessionSelect,
        }),
      );

      // The audit row goes in the same transaction as everything above (#188).
      await recordAudit(tx, ctx, audit(dto));

      return dto;
    }).catch((e: unknown) => {
      // El único caso en que la transacción se aborta a propósito: el turno
      // ya tenía sesión. Todo lo demás sigue siendo un error de verdad.
      if (e instanceof TurnoYaRegistrado) return null;
      throw e;
    });

    if (session === null) return { ok: false, reason: 'appointment_taken' };
    return { ok: true, session };
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: SessionUpdateInput,
    audit: AuditUpdateBuilder<SessionDTO, SessionAuditField>,
  ): Promise<SessionUpdateResult> {
    const db = forTenant(ctx);
    const notFound = { ok: false, reason: 'not_found' } as const;

    try {
      // The audit row goes in the same transaction as the write (#188). A
      // P2025 thrown inside rolls it back and becomes not_found below.
      return await db.$transaction(async (tx): Promise<SessionUpdateResult> => {
        // Locked and read first, to record which fields changed (#186): a
        // concurrent edit waits for this one. No row (gone, deleted, another
        // patient's) is the same 404 as the update's P2025 below.
        await lockRow(tx, 'sessions', id, ctx.tenantId);
        const beforeRow = await tx.session.findFirst({
          where: { ...VIGENTE, id, patientId, tenantId: ctx.tenantId },
          select: sessionSelect,
        });
        if (!beforeRow) return notFound;
        const before = toDTO(beforeRow);

        // `episodes` is the whole set of blocks when it comes (issue #97: a
        // missing field is "leave it", never "empty it").
        const blocks =
          input.episodes === undefined ? before.episodes : mergeBlocks(before.episodes, input.episodes);
        const violation = episodeRuleViolation(input.sessionType ?? before.sessionType, blocks.length);
        if (violation) return { ok: false, reason: violation };

        // patientId en el where del update (Prisma 5 acepta campos no únicos en
        // WhereUniqueInput): pertenencia y tenant se deciden en la misma query
        // que escribe. deletedAt también: una sesión borrada no se edita. Si no
        // matchea, Prisma tira P2025 y esto devuelve not_found → 404.
        await tx.session.update({
          where: { ...VIGENTE, id, patientId, tenantId: ctx.tenantId },
          // updatedAt by hand: an edit that touches only the blocks writes no
          // column of the session, and the session still changed.
          data: { ...sessionData(input), updatedAt: new Date() },
          select: { id: true },
        });

        if (input.episodes !== undefined) {
          // A block left out is removed, a new one added, a kept one rewritten
          // with its merged fields.
          const kept = new Set(blocks.map((b) => b.episodeId));
          const existing = new Set(before.episodes.map((b) => b.episodeId));
          const removed = before.episodes.map((b) => b.episodeId).filter((e) => !kept.has(e));
          if (removed.length > 0) {
            await tx.sessionEpisode.deleteMany({
              where: { tenantId: ctx.tenantId, sessionId: id, episodeId: { in: removed } },
            });
          }
          for (const { episodeId, ...fields } of blocks) {
            if (existing.has(episodeId)) {
              await tx.sessionEpisode.update({
                where: { sessionId_episodeId: { sessionId: id, episodeId }, tenantId: ctx.tenantId },
                data: fields,
              });
            } else {
              await tx.sessionEpisode.create({
                data: { ...fields, tenantId: ctx.tenantId, patientId, sessionId: id, episodeId },
              });
            }
          }
        }

        const session = toDTO(
          await tx.session.findUniqueOrThrow({
            where: { id, tenantId: ctx.tenantId },
            select: sessionSelect,
          }),
        );
        const changed = nonEmpty(changedFields(auditView(before), auditView(session), AUDIT_FIELDS));
        if (changed) await recordAudit(tx, ctx, audit(session, changed));
        return { ok: true, session };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return notFound;
      }
      throw e;
    }
  },

  async softDelete(
    ctx: TenantContext,
    patientId: string,
    id: string,
    audit: AuditEntry,
  ): Promise<'deleted' | 'not_found' | 'paid'> {
    const db = forTenant(ctx);

    return db.$transaction(async (tx) => {
      // 1. Sacar el cobro, salvo que esté PAGADO. La condición va en el where
      //    del delete: si estaba pagado no borra nada y la fila sigue ahí.
      //
      //    Se elimina de verdad y no se marca: un cobro PENDING o WAIVED por
      //    una sesión que no existió no es historial —no hubo plata— sino
      //    trabajo pendiente sobre algo que no pasó. Borrarlo también evita
      //    tener que filtrar sesiones borradas en Cobros y en el remanente de
      //    los paquetes, que es justo el filtro que después alguien olvida.
      await tx.payment.deleteMany({
        where: { sessionId: id, tenantId: ctx.tenantId, status: { not: 'PAID' } },
      });

      // 2. Borrar la sesión solo si ya no le queda ningún cobro colgando. Si
      //    el cobro estaba pagado sigue existiendo y este updateMany no toca
      //    nada: la condición viaja en el where del write, sin ventana entre
      //    el chequeo y la escritura.
      const { count } = await tx.session.updateMany({
        where: { id, patientId, tenantId: ctx.tenantId, deletedAt: null, payment: { is: null } },
        data: { deletedAt: new Date() },
      });

      if (count === 1) {
        // 3. Soltar el turno del que salió la sesión, si hubo uno. Sin esto
        //    el turno quedaría apuntando a una sesión que ya no se ve: la
        //    agenda diría para siempre "la sesión ya está registrada" y el
        //    POST con ese appointmentId daría 409 por el sessionId ocupado.
        //    Se limpia solo el vínculo; el estado no se toca, porque que la
        //    sesión se haya cargado mal no dice nada sobre si el paciente
        //    vino (COMPLETED sin sessionId es un estado válido: "vino, sin
        //    sesión registrada"). Si en realidad no vino, la agenda deja
        //    marcarlo NO_SHOW igual que siempre.
        await tx.appointment.updateMany({
          where: { sessionId: id, tenantId: ctx.tenantId },
          data: { sessionId: null },
        });
        // The audit row goes in the same transaction as the deletion (#188).
        await recordAudit(tx, ctx, audit);
        return 'deleted';
      }

      // count 0 son dos casos distintos para el cliente: la sesión existe
      // pero está cobrada (409), o no existe / ya estaba borrada (404).
      const stillThere = await tx.session.findFirst({
        where: { id, patientId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      return stillThere ? 'paid' : 'not_found';
    });
  },
};
