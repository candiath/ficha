import type { PaymentMethod, PaymentStatus, SessionType } from '@prisma/client';
import type { TenantContext } from './types';
import type { AUDIT_PAYMENT_FIELDS } from '@ficha/shared';
import type { AuditBuilder, AuditUpdateBuilder } from './auditLogRepository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Amounts in integer cents, as numbers (BIGINT in the database): the
// conversion lives in the repository, not in every route that serializes.
export interface PaymentDTO {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmountCents: number;
  discountCents: number;
  finalAmountCents: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
  session: { id: string; sessionDate: string; sessionType: SessionType };
  package: { id: string; name: string } | null;
}

export interface PaymentListFilters {
  patientId?: string;
  status?: PaymentStatus;
}

// Sin patientId: el paciente se deriva de la sesión. Aceptarlo del body
// permitía crear pagos apuntando a pacientes de otro tenant.
export interface PaymentCreateInput {
  sessionId: string;
  packageId?: string | null;
  baseAmountCents: number;
  discountCents: number;
  notes?: string | null;
}

// paidAt and method go with PAID and only with it (a CHECK in the database):
// absent means "keep, or now for a payment that becomes PAID", null means
// "none". The repository settles them against the status the payment ends in.
export interface PaymentUpdateInput {
  baseAmountCents?: number;
  discountCents?: number;
  status?: PaymentStatus;
  method?: PaymentMethod | null;
  paidAt?: Date | null;
  packageId?: string | null;
  notes?: string | null;
}

export type PaymentCreateResult =
  | { ok: true; payment: PaymentDTO }
  | { ok: false; reason: 'session_not_found' | 'package_not_found' | 'duplicate' };

export type PaymentUpdateResult =
  | { ok: true; payment: PaymentDTO }
  // invalid_amounts: el descuento supera al monto base, o sea que
  // finalAmountCents quedaría negativo — un cobro que devuelve plata.
  // paid_without_method / paid_without_date: a PAID payment records how and
  // when the money came in. payment_data_without_paid: a method or a date
  // sent for a payment that does not end PAID, money that did not come in.
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'package_not_found'
        | 'invalid_amounts'
        | 'paid_without_method'
        | 'paid_without_date'
        | 'payment_data_without_paid';
    };

export interface LastBasePrice {
  amountCents: number | null;
  date: string;
  isStale: boolean;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export type PaymentAuditField = keyof typeof AUDIT_PAYMENT_FIELDS;

export interface PaymentRepository {
  list(ctx: TenantContext, filters?: PaymentListFilters): Promise<PaymentDTO[]>;
  /**
   * Último baseAmountCents de un pago sin descuento ni paquete; amountCents null si
   * es más viejo que el umbral de vigencia. null si nunca hubo uno.
   */
  lastBasePrice(ctx: TenantContext): Promise<LastBasePrice | null>;
  /**
   * Deriva el paciente de la sesión, valida el paquete contra ese paciente,
   * calcula finalAmountCents e impone un pago por sesión (unique de sessionId,
   * con el catch de P2002 adentro para la carrera).
   */
  create(
    ctx: TenantContext,
    input: PaymentCreateInput,
    audit: AuditBuilder<PaymentDTO>,
  ): Promise<PaymentCreateResult>;
  /**
   * Recalcula finalAmountCents con los montos nuevos o los existentes, y rechaza
   * la combinación que lo dejaría negativo. El chequeo vive acá y no en el
   * schema de la ruta porque el PATCH es parcial: mandar solo `discountCents`
   * puede pasar el monto base guardado, que Zod no conoce.
   */
  update(
    ctx: TenantContext,
    id: string,
    input: PaymentUpdateInput,
    // Called only when a field changed, with the changed fields' names.
    audit: AuditUpdateBuilder<PaymentDTO, PaymentAuditField>,
  ): Promise<PaymentUpdateResult>;
}
