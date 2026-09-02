import type { SessionType } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Una sesión puede abordar varios episodios (motivos) a la vez: el pivote se
// aplana a episodeIds para que el cliente trabaje con un arreglo plano.
export interface SessionDTO {
  id: string;
  patientId: string;
  sessionType: SessionType;
  sessionDate: string;
  preSesionState: string | null;
  reEvaluationNotes: string | null;
  patientResponse: string | null;
  painScaleBefore: number | null;
  painScaleAfter: number | null;
  observations: string | null;
  createdAt: string;
  updatedAt: string;
  episodeIds: string[];
}

// El listado global (GET /api/sessions) agrega el paciente y el detalle de
// los episodios: es la vista de agenda, sin un paciente en la URL.
export interface SessionWithPatientDTO extends Omit<SessionDTO, 'episodeIds'> {
  patient: { id: string; fullName: string };
  episodes: { id: string; mainComplaint: string | null }[];
  episodeIds: string[];
}

export interface SessionFields {
  sessionType: SessionType;
  sessionDate: Date;
  preSesionState?: string | null;
  reEvaluationNotes?: string | null;
  patientResponse?: string | null;
  painScaleBefore?: number | null;
  painScaleAfter?: number | null;
  observations?: string | null;
}

export interface SessionPaymentInput {
  packageId?: string | null;
  baseAmount: number;
  discount: number;
  notes?: string | null;
}

// El POST crea la sesión con su cobro de una sola vez: antes el frontend
// encadenaba varios requests y un fallo intermedio dejaba sesiones sin pago
// (invisibles en Cobros).
export interface SessionCreateInput extends SessionFields {
  episodeIds: string[];
  payment?: SessionPaymentInput;
}

// payment queda afuera a propósito: el pago se edita por /api/payments.
export type SessionUpdateInput = Partial<SessionFields> & { episodeIds?: string[] };

// ─── Port ────────────────────────────────────────────────────────────────────

// Como episodios y escalas: los métodos anidados piden patientId, y una
// sesión de otro paciente cuenta como inexistente. La vigencia del paciente
// la exige la ruta con patientRepo.exists; la pertenencia de episodios y
// paquete se valida antes con sus repos.
export interface SessionRepository {
  listByPatient(
    ctx: TenantContext,
    patientId: string,
    filters?: { episodeId?: string },
  ): Promise<SessionDTO[]>;
  /** null si la sesión no existe, es de otro paciente o de otro tenant. */
  getById(ctx: TenantContext, patientId: string, id: string): Promise<SessionDTO | null>;
  /** Todas las sesiones del tenant con nombre de paciente (vista de agenda). */
  listAllForTenant(ctx: TenantContext): Promise<SessionWithPatientDTO[]>;
  /**
   * Crea sesión + cobro + cierre de episodios en una transacción: si algo
   * falla no queda una sesión a medias. La sesión se atribuye al usuario del
   * contexto.
   */
  create(
    ctx: TenantContext,
    patientId: string,
    input: SessionCreateInput,
  ): Promise<SessionDTO>;
  /** null si no hay sesión vigente de ese paciente con ese id. */
  update(
    ctx: TenantContext,
    patientId: string,
    id: string,
    input: SessionUpdateInput,
  ): Promise<SessionDTO | null>;
}
