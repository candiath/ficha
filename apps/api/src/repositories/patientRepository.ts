import type { Sex } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Fechas como ISO strings: es lo que Express produce al serializar Date, así
// el contrato con el front (apps/web/src/types/patient.ts) queda idéntico.
export interface PatientDTO {
  id: string;
  fullName: string;
  birthDate: string | null;
  sex: Sex | null;
  phone: string | null;
  occupation: string | null;
  referringDoctor: string | null;
  insuranceName: string | null;
  insuranceNumber: string | null;
  insurancePlan: string | null;
  createdAt: string;
  updatedAt: string;
}

// Sin tenantId ni deletedAt: el primero lo inyecta el guard, el segundo es
// una decisión del repositorio (softDelete), no un dato que viaje en un form.
export interface PatientCreateInput {
  fullName: string;
  birthDate?: Date | null;
  sex?: Sex | null;
  phone?: string | null;
  occupation?: string | null;
  referringDoctor?: string | null;
  insuranceName?: string | null;
  insuranceNumber?: string | null;
  insurancePlan?: string | null;
}

export type PatientUpdateInput = Partial<PatientCreateInput>;

// ─── Port ────────────────────────────────────────────────────────────────────

// Política del repositorio: TODO método opera sobre pacientes vigentes
// (deletedAt: null). Es la razón de que este repo exista — el guard de tenant
// no puede inyectar ese filtro (no es uniforme: qué es "visible" depende del
// caso de uso), así que vive acá, una sola vez, en lugar de en cada ruta.
// Un método futuro que incluya borrados debe decirlo en el nombre
// (p. ej. listIncludingDeleted), nunca cambiar el default.
export interface PatientRepository {
  list(ctx: TenantContext): Promise<PatientDTO[]>;
  getById(ctx: TenantContext, id: string): Promise<PatientDTO | null>;
  /** true si el paciente existe, es del tenant y no está borrado. */
  exists(ctx: TenantContext, id: string): Promise<boolean>;
  create(ctx: TenantContext, input: PatientCreateInput): Promise<PatientDTO>;
  /** null si el paciente no existe, es de otro tenant o está borrado. */
  update(ctx: TenantContext, id: string, input: PatientUpdateInput): Promise<PatientDTO | null>;
  /** Borrado lógico. false si no había paciente vigente que borrar. */
  softDelete(ctx: TenantContext, id: string): Promise<boolean>;
}
