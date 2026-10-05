import { forTenant } from '../../lib/tenantScope';
import type { AuditBuilder, AuditEntry } from '../auditLogRepository';
import type { TenantContext } from '../types';
import { recordAudit } from './recordAudit';
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

  // Every write below records its audit row in the same transaction (#188).

  async create(
    ctx: TenantContext,
    input: PatientCreateInput,
    audit: AuditBuilder<PatientDTO>,
  ): Promise<PatientDTO> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      const row = await tx.patient.create({
        data: { ...input, tenantId: ctx.tenantId },
        select: patientSelect,
      });
      const patient = toDTO(row);
      await recordAudit(tx, ctx, audit(patient));
      return patient;
    });
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: PatientUpdateInput,
    audit: AuditBuilder<PatientDTO>,
  ): Promise<PatientDTO | null> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // updateMany y no update: el where con deletedAt hace que existencia,
      // pertenencia y vigencia se decidan en la misma query que escribe
      // (count 0 = no había paciente vigente), sin ventana entre chequeo y update.
      const { count } = await tx.patient.updateMany({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        data: input,
      });
      if (count === 0) return null;
      const row = await tx.patient.findFirstOrThrow({
        where: { id, tenantId: ctx.tenantId },
        select: patientSelect,
      });
      const patient = toDTO(row);
      await recordAudit(tx, ctx, audit(patient));
      return patient;
    });
  },

  async softDelete(ctx: TenantContext, id: string, audit: AuditEntry): Promise<boolean> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // El deletedAt: null del where hace el borrado idempotente hacia afuera:
      // borrar dos veces da 404 la segunda, no re-marca la fila.
      const { count } = await tx.patient.updateMany({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) return false;
      await recordAudit(tx, ctx, audit);
      return true;
    });
  },
};
