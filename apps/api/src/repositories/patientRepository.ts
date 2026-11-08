import type { Sex } from '@prisma/client';
import type { TenantContext } from './types';
import type { AUDIT_PATIENT_FIELDS } from '@ficha/shared';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Fechas como ISO strings: es lo que Express produce al serializar Date, así
// el contrato con el front (apps/web/src/types/patient.ts) queda idéntico.
export interface PatientDTO {
  id: string;
  firstName: string;
  lastName: string;
  // "firstName lastName", for display; built from the two (patientName.ts).
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
  firstName: string;
  lastName: string;
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

// What an edit carries besides the fields (SPEC-clinical-revisions.md §5): the
// version the form loaded, and the note of the correction, which goes only into
// the revision.
export interface PatientEditMeta {
  expectedVersion?: number;
  reasonNote?: string | null;
}

// The patient as the record reads it, with its latest version (0: none yet).
// Lists carry no version: an edit form renders only from the record.
export interface PatientRecordDTO extends PatientDTO {
  version: number;
}

export type PatientUpdateResult =
  | { ok: true; patient: PatientRecordDTO }
  | { ok: false; reason: 'not_found' | 'stale' };

// ─── Port ────────────────────────────────────────────────────────────────────

// Política del repositorio: TODO método opera sobre pacientes vigentes
// (deletedAt: null). Es la razón de que este repo exista — el guard de tenant
// no puede inyectar ese filtro (no es uniforme: qué es "visible" depende del
// caso de uso), así que vive acá, una sola vez, en lugar de en cada ruta.
// Un método futuro que incluya borrados debe decirlo en el nombre
// (p. ej. listIncludingDeleted), nunca cambiar el default.
//
// Alcance del borrado lógico (decisión de producto, issue #72 cerrado by
// design): un paciente borrado desaparece del listado, su ficha da 404 y no
// puede recibir datos clínicos nuevos —las rutas que crean bajo un paciente
// pasan por exists()—, PERO el historial ya registrado lo sigue nombrando:
// los joins con el nombre del paciente de cobros, sesiones y
// paquetes NO filtran deletedAt a propósito. Borrar un paciente oculta al
// paciente, no reescribe el pasado.
//
// La línea que separa las dos mitades es historial vs. trabajo pendiente. Por
// eso las ALERTAS sí filtran pacientes borrados (clinicalAlertRepository):
// no son un registro de lo que pasó sino un pedido de acción, y sobre un
// paciente eliminado esa acción es imposible.
export type PatientAuditField = keyof typeof AUDIT_PATIENT_FIELDS;

export interface PatientRepository {
  list(ctx: TenantContext): Promise<PatientDTO[]>;
  getById(ctx: TenantContext, id: string): Promise<PatientRecordDTO | null>;
  /** true si el paciente existe, es del tenant y no está borrado. */
  exists(ctx: TenantContext, id: string): Promise<boolean>;
  /** Writes version 1 with its audit row. */
  create(ctx: TenantContext, input: PatientCreateInput, audit: AuditBuilder<PatientDTO>): Promise<PatientRecordDTO>;
  /**
   * `not_found` si el paciente no existe, es de otro tenant o está borrado;
   * `stale` if `expectedVersion` is not the latest. Records an audit row only
   * when a field changed, with the changed fields' names, and a version only
   * when a versioned field changed (contact and coverage are not).
   */
  update(
    ctx: TenantContext,
    id: string,
    input: PatientUpdateInput & PatientEditMeta,
    audit: AuditUpdateBuilder<PatientDTO, PatientAuditField>,
  ): Promise<PatientUpdateResult>;
  /** Borrado lógico, with a version of unchanged content. false si no había paciente vigente que borrar. */
  softDelete(ctx: TenantContext, id: string, audit: AuditEntry): Promise<boolean>;
}
