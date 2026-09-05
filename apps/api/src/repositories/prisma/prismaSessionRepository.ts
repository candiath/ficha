import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionDTO,
  SessionRepository,
  SessionUpdateInput,
  SessionWithPatientDTO,
} from '../sessionRepository';

// Política del repositorio: todo método opera sobre sesiones vigentes. Una
// sesión borrada no se lista, no se lee y no se edita — el mismo criterio que
// patientRepository aplica a los pacientes.
const VIGENTE = { deletedAt: null } as const;

// Se lanza dentro de la transacción para que Prisma la revierta, y se
// convierte en un resultado justo afuera. Es la forma de abortar una
// transacción interactiva sin que el error salga como un 500.
class TurnoYaRegistrado extends Error {}

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

  async listAllForTenant(ctx: TenantContext): Promise<SessionWithPatientDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.session.findMany({
      where: VIGENTE,
      orderBy: { sessionDate: 'desc' },
      select: sessionWithPatientSelect,
    });
    return rows.map(toWithPatientDTO);
  },

  async create(
    ctx: TenantContext,
    patientId: string,
    input: SessionCreateInput,
  ): Promise<SessionCreateResult> {
    const db = forTenant(ctx);
    const { episodeIds, payment, appointmentId } = input;

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

      return created;
    }).catch((e: unknown) => {
      // El único caso en que la transacción se aborta a propósito: el turno
      // ya tenía sesión. Todo lo demás sigue siendo un error de verdad.
      if (e instanceof TurnoYaRegistrado) return null;
      throw e;
    });

    if (row === null) return { ok: false, reason: 'appointment_taken' };
    return { ok: true, session: toDTO(row) };
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
        // deletedAt en el where: una sesión borrada no se edita. Si no
        // matchea, Prisma tira P2025 y esto devuelve null → 404.
        where: { ...VIGENTE, id, patientId },
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

  async softDelete(
    ctx: TenantContext,
    patientId: string,
    id: string,
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

      if (count === 1) return 'deleted';

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
