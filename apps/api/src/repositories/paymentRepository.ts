import type { PaymentMethod, PaymentStatus, SessionType } from '@prisma/client';
import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Montos como number (en la DB son Decimal): la conversión vive en el repo,
// no en cada ruta que serializa.
export interface PaymentDTO {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmount: number;
  discount: number;
  finalAmount: number;
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
  baseAmount: number;
  discount: number;
  notes?: string | null;
}

// paidAt llega ya resuelto (el default "PAID sin paidAt → ahora" es de la
// ruta, que distingue ausente de null en el body).
export interface PaymentUpdateInput {
  baseAmount?: number;
  discount?: number;
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
  // finalAmount quedaría negativo — un cobro que devuelve plata.
  | { ok: false; reason: 'not_found' | 'package_not_found' | 'invalid_amounts' };

export interface LastBasePrice {
  amount: number | null;
  date: string;
  isStale: boolean;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface PaymentRepository {
  list(ctx: TenantContext, filters?: PaymentListFilters): Promise<PaymentDTO[]>;
  /**
   * Último baseAmount de un pago sin descuento ni paquete; amount null si
   * es más viejo que el umbral de vigencia. null si nunca hubo uno.
   */
  lastBasePrice(ctx: TenantContext): Promise<LastBasePrice | null>;
  /**
   * Deriva el paciente de la sesión, valida el paquete contra ese paciente,
   * calcula finalAmount e impone un pago por sesión (unique de sessionId,
   * con el catch de P2002 adentro para la carrera).
   */
  create(ctx: TenantContext, input: PaymentCreateInput): Promise<PaymentCreateResult>;
  /**
   * Recalcula finalAmount con los montos nuevos o los existentes, y rechaza
   * la combinación que lo dejaría negativo. El chequeo vive acá y no en el
   * schema de la ruta porque el PATCH es parcial: mandar solo `discount`
   * puede pasar el monto base guardado, que Zod no conoce.
   */
  update(ctx: TenantContext, id: string, input: PaymentUpdateInput): Promise<PaymentUpdateResult>;
}
