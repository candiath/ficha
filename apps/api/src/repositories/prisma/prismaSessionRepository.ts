import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  SessionCreateInput,
  SessionDTO,
  SessionRepository,
  SessionUpdateInput,
  SessionWithPatientDTO,
} from '../sessionRepository';

const sessionSelect = {
  id: true,
  patientId: true,
  sessionType: true,
  sessionDate: true,
  preSesionState: true,
  reEvaluationNotes: true,
  patientResponse: true,
  painScaleBefore: true,
  painScaleAfter: true,
  observations: true,
  createdAt: true,
  updatedAt: true,
  // orderBy explícito: sin él, una sesión con varios episodios devuelve los
  // episodeIds en orden indefinido (Postgres no garantiza ninguno sin ORDER
  // BY) y el mismo GET puede responder distinto entre llamadas. El pivote no
  // tiene timestamp, así que se ordena por episodeId: arbitrario, pero
  // estable y cubierto por la PK compuesta.
  episodes: { select: { episodeId: true }, orderBy: { episodeId: 'asc' } },
} as const;

// El listado global suma el paciente y el motivo de cada episodio.
const sessionWithPatientSelect = {
  ...sessionSelect,
  patient: { select: { id: true, fullName: true } },
  // Mismo criterio que sessionSelect: orden estable entre requests.
  episodes: {
    select: { episode: { select: { id: true, mainComplaint: true } } },
    orderBy: { episodeId: 'asc' },
  },
} as const;

type SessionRow = {
  id: string;
  patientId: string;
  sessionType: SessionDTO['sessionType'];
  sessionDate: Date;
  preSesionState: string | null;
  reEvaluationNotes: string | null;
  patientResponse: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  observations: string | null;
  createdAt: Date;
  updatedAt: Date;
  episodes: { episodeId: string }[];
};

type SessionWithPatientRow = Omit<SessionRow, 'episodes'> & {
  patient: { id: string; fullName: string };
  episodes: { episode: { id: string; mainComplaint: string | null } }[];
};

function toDTO({ episodes, ...rest }: SessionRow): SessionDTO {
  return {
    ...rest,
    sessionDate: rest.sessionDate.toISOString(),
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
    episodeIds: episodes.map((e) => e.episodeId),
  };
}

function toWithPatientDTO({ episodes, ...rest }: SessionWithPatientRow): SessionWithPatientDTO {
  const linked = episodes.map((e) => e.episode);
  return {
    ...rest,
    sessionDate: rest.sessionDate.toISOString(),
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
    episodes: linked,
    episodeIds: linked.map((e) => e.id),
  };
}

// Los campos propios de la sesión, sin los ids de episodio ni las relaciones.
function sessionData(input: Partial<SessionCreateInput>) {
  return {
    ...(input.sessionType !== undefined && { sessionType: input.sessionType }),
    ...(input.sessionDate !== undefined && { sessionDate: input.sessionDate }),
    ...(input.preSesionState !== undefined && { preSesionState: input.preSesionState }),
    ...(input.reEvaluationNotes !== undefined && { reEvaluationNotes: input.reEvaluationNotes }),
    ...(input.patientResponse !== undefined && { patientResponse: input.patientResponse }),
    ...(input.painScaleBefore !== undefined && { painScaleBefore: input.painScaleBefore }),
    ...(input.painScaleAfter !== undefined && { painScaleAfter: input.painScaleAfter }),
    ...(input.observations !== undefined && { observations: input.observations }),
  };
}

// Filas del pivote sesión↔episodio a partir de los ids.
function episodeLinks(episodeIds: string[]) {
  return episodeIds.map((episodeId) => ({ episode: { connect: { id: episodeId } } }));
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
      where: { id, patientId },
      select: sessionSelect,
    });
    return row ? toDTO(row) : null;
  },

  async listAllForTenant(ctx: TenantContext): Promise<SessionWithPatientDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.session.findMany({
      orderBy: { sessionDate: 'desc' },
      select: sessionWithPatientSelect,
    });
    return rows.map(toWithPatientDTO);
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: SessionCreateInput,
  ): Promise<SessionDTO> {
    const db = forTenant(ctx);
    const { episodeIds, payment } = input;

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
    const row = await db.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          ...sessionData(input),
          sessionType: input.sessionType,
          sessionDate: input.sessionDate,
          patientId,
          tenantId: ctx.tenantId,
          // La sesión queda atribuida al usuario autenticado que la registra.
          userId: ctx.userId,
          episodes: { create: episodeLinks(episodeIds) },
        },
        select: sessionSelect,
      });

      if (payment) {
        await tx.payment.create({
          data: {
            tenantId: ctx.tenantId,
            patientId,
            sessionId: created.id,
            packageId: payment.packageId ?? null,
            baseAmount: payment.baseAmount,
            discount: payment.discount,
            finalAmount: payment.baseAmount - payment.discount,
            notes: payment.notes ?? null,
          },
        });
      }

      // Cierre automático del/los episodio(s) al registrar alta. Dentro de la
      // transacción: antes era fire-and-forget y un fallo dejaba el alta
      // registrada con el episodio todavía abierto.
      if (input.sessionType === 'DISCHARGE' && episodeIds.length > 0) {
        await tx.clinicalEpisode.updateMany({
          where: { id: { in: episodeIds }, tenantId: ctx.tenantId },
          data: { status: 'DISCHARGED', closedAt: new Date() },
        });
      }

      return created;
    });

    return toDTO(row);
  },

  async update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: SessionUpdateInput,
  ): Promise<SessionDTO | null> {
    const db = forTenant(ctx);
    const { episodeIds } = input;

    try {
      // patientId en el where del update (Prisma 5 acepta campos no únicos en
      // WhereUniqueInput): pertenencia y tenant se deciden en la misma query
      // que escribe. Si no matchea, Prisma tira P2025 y devolvemos null —
      // el reemplazo de episodios es anidado y no se puede hacer con
      // updateMany, así que este es el equivalente sin ventana.
      const row = await db.session.update({
        where: { id, patientId },
        data: {
          ...sessionData(input),
          // Reemplaza el conjunto de episodios vinculados solo si se envía.
          // !== undefined y no truthy: [] significa "desvincular todos" y es
          // distinto de "el campo no vino" (issue #97).
          ...(episodeIds !== undefined
            ? { episodes: { deleteMany: {}, create: episodeLinks(episodeIds) } }
            : {}),
        },
        select: sessionSelect,
      });
      return toDTO(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        return null;
      }
      throw e;
    }
  },
};
