import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  PatientCreateInput,
  PatientDTO,
  PatientRepository,
  PatientUpdateInput,
} from '../patientRepository';

// tenantId y deletedAt se excluyen a propósito: el primero es interno,
// el segundo siempre es null acá (el repo solo devuelve vigentes).
const patientSelect = {
  id: true,
  fullName: true,
  birthDate: true,
  sex: true,
  phone: true,
  occupation: true,
  referringDoctor: true,
  insuranceName: true,
  insuranceNumber: true,
  insurancePlan: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PatientRow = {
  id: string;
  fullName: string;
  birthDate: Date | null;
  sex: PatientDTO['sex'];
  phone: string | null;
  occupation: string | null;
  referringDoctor: string | null;
  insuranceName: string | null;
  insuranceNumber: string | null;
  insurancePlan: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDTO(row: PatientRow): PatientDTO {
  return {
    ...row,
    birthDate: row.birthDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getById(ctx: TenantContext, id: string): Promise<PatientDTO | null> {
  const db = forTenant(ctx);
  const row = await db.patient.findFirst({
    where: { id, deletedAt: null },
    select: patientSelect,
  });
  return row ? toDTO(row) : null;
}

export const prismaPatientRepository: PatientRepository = {
  async list(ctx: TenantContext): Promise<PatientDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.patient.findMany({
      where: { deletedAt: null },
      select: patientSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDTO);
  },

  getById,

  async exists(ctx: TenantContext, id: string): Promise<boolean> {
    const db = forTenant(ctx);
    const row = await db.patient.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  },

  async create(ctx: TenantContext, input: PatientCreateInput): Promise<PatientDTO> {
    const db = forTenant(ctx);
    const row = await db.patient.create({ data: input, select: patientSelect });
    return toDTO(row);
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: PatientUpdateInput,
  ): Promise<PatientDTO | null> {
    const db = forTenant(ctx);
    // updateMany y no update: el where con deletedAt hace que existencia,
    // pertenencia y vigencia se decidan en la misma query que escribe
    // (count 0 = no había paciente vigente), sin ventana entre chequeo y update.
    const { count } = await db.patient.updateMany({
      where: { id, deletedAt: null },
      data: input,
    });
    if (count === 0) return null;
    return getById(ctx, id);
  },

  async softDelete(ctx: TenantContext, id: string): Promise<boolean> {
    const db = forTenant(ctx);
    // El deletedAt: null del where hace el borrado idempotente hacia afuera:
    // borrar dos veces da 404 la segunda, no re-marca la fila.
    const { count } = await db.patient.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  },
};
