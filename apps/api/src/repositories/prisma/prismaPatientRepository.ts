import { AUDIT_PATIENT_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { fullName, patientNameSelect } from './patientName';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../auditLogRepository';
import type { TenantContext } from '../types';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';
import type {
  PatientCreateInput,
  PatientAuditField,
  PatientDTO,
  PatientRepository,
  PatientUpdateInput,
} from '../patientRepository';

// tenantId y deletedAt se excluyen a propósito: el primero es interno,
// el segundo siempre es null acá (el repo solo devuelve vigentes).
const patientSelect = {
  id: true,
  ...patientNameSelect,
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
  firstName: string;
  lastName: string;
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

const AUDIT_FIELDS = Object.keys(AUDIT_PATIENT_FIELDS) as PatientAuditField[];

function toDTO(row: PatientRow): PatientDTO {
  return {
    ...row,
    fullName: fullName(row),
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
      // By surname, as the clinic looks patients up (#238).
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
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
    audit: AuditUpdateBuilder<PatientDTO, PatientAuditField>,
  ): Promise<PatientDTO | null> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // Locked and read first, to record which fields changed (#186): a
      // concurrent edit waits for this one.
      await lockRow(tx, 'patients', id, ctx.tenantId);
      const before = await tx.patient.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        select: patientSelect,
      });
      if (!before) return null;

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
      const changed = nonEmpty(changedFields(toDTO(before), patient, AUDIT_FIELDS));
      if (changed) await recordAudit(tx, ctx, audit(patient, changed));
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
