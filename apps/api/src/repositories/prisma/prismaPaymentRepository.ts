import { Prisma } from '@prisma/client';
import { AUDIT_PAYMENT_FIELDS } from '@ficha/shared';
import { forTenant } from '../../lib/tenantScope';
import { settle } from '../../lib/paymentSettlement';
import type { TenantContext } from '../types';
import type {
  LastBasePrice,
  PaymentAuditField,
  PaymentCreateInput,
  PaymentCreateResult,
  PaymentDTO,
  PaymentListFilters,
  PaymentRepository,
  PaymentUpdateInput,
  PaymentUpdateResult,
} from '../paymentRepository';
import type { AuditBuilder, AuditUpdateBuilder } from '../auditLogRepository';
import { changedFields, lockRow, nonEmpty } from './changedFields';
import { recordAudit } from './recordAudit';

// Días máximos de antigüedad para considerar vigente el último precio base.
// Cambiar acá cuando se quiera hacer configurable.
const LAST_BASE_PRICE_STALENESS_DAYS = 90;

const paymentSelect = {
  id: true,
  patientId: true,
  sessionId: true,
  packageId: true,
  baseAmountCents: true,
  discountCents: true,
  finalAmountCents: true,
  status: true,
  method: true,
  paidAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { id: true, fullName: true } },
  session: { select: { id: true, sessionDate: true, sessionType: true } },
  package: { select: { id: true, name: true } },
} as const;

type PaymentRow = {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmountCents: bigint;
  discountCents: bigint;
  finalAmountCents: bigint;
  status: PaymentDTO['status'];
  method: PaymentDTO['method'];
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; fullName: string };
  session: { id: string; sessionDate: Date; sessionType: PaymentDTO['session']['sessionType'] };
  package: { id: string; name: string } | null;
};

const AUDIT_FIELDS = Object.keys(AUDIT_PAYMENT_FIELDS) as PaymentAuditField[];

function toDTO(row: PaymentRow): PaymentDTO {
  return {
    ...row,
    baseAmountCents: Number(row.baseAmountCents),
    discountCents: Number(row.discountCents),
    finalAmountCents: Number(row.finalAmountCents),
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    session: { ...row.session, sessionDate: row.session.sessionDate.toISOString() },
  };
}

export const prismaPaymentRepository: PaymentRepository = {
  async list(ctx: TenantContext, filters?: PaymentListFilters): Promise<PaymentDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.payment.findMany({
      where: {
        ...(filters?.patientId ? { patientId: filters.patientId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      select: paymentSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDTO);
  },

  async lastBasePrice(ctx: TenantContext): Promise<LastBasePrice | null> {
    const db = forTenant(ctx);
    const row = await db.payment.findFirst({
      where: { discountCents: 0, packageId: null },
      select: { baseAmountCents: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;

    const ageInDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
    const isStale = ageInDays > LAST_BASE_PRICE_STALENESS_DAYS;

    return {
      amountCents: isStale ? null : Number(row.baseAmountCents),
      date: row.createdAt.toISOString(),
      isStale,
    };
  },

  async create(
    ctx: TenantContext,
    input: PaymentCreateInput,
    audit: AuditBuilder<PaymentDTO>,
  ): Promise<PaymentCreateResult> {
    const db = forTenant(ctx);

    // El paciente se deriva de la sesión: la sesión debe ser del tenant.
    const session = await db.session.findFirst({
      // deletedAt: null — no se registra un cobro sobre una sesión borrada.
      where: { id: input.sessionId, deletedAt: null },
      select: { id: true, patientId: true },
    });
    if (!session) return { ok: false, reason: 'session_not_found' };

    // El paquete a debitar debe ser del tenant y del MISMO paciente que la
    // sesión: sin esto se podía descontar sesiones del paquete de otro.
    if (input.packageId) {
      const pkg = await db.sessionPackage.findFirst({
        where: { id: input.packageId, patientId: session.patientId },
        select: { id: true },
      });
      if (!pkg) return { ok: false, reason: 'package_not_found' };
    }

    // Dos capas contra el pago duplicado: el pre-chequeo atrapa el caso
    // secuencial sin ensuciar el log, y el catch de P2002 la carrera real
    // (dos requests que pasan el pre-chequeo antes de que ninguno confirme).
    const existing = await db.payment.findUnique({
      where: { sessionId: input.sessionId },
      select: { id: true },
    });
    if (existing) return { ok: false, reason: 'duplicate' };

    // Mismo criterio que el cobro embebido en el alta de la sesión: si no hay
    // nada que cobrar, el cobro nace eximido y no como deuda.
    const { finalAmountCents, status } = settle(input.baseAmountCents, input.discountCents);

    // The audit row goes in the same transaction as the write (#188). The
    // duplicate is caught outside it: a unique violation aborts the
    // transaction, so it cannot be handled inside the callback.
    try {
      const payment = await db.$transaction(async (tx) => {
        const row = await tx.payment.create({
          data: {
            tenantId: ctx.tenantId,
            patientId: session.patientId,
            sessionId: input.sessionId,
            packageId: input.packageId ?? null,
            baseAmountCents: input.baseAmountCents,
            discountCents: input.discountCents,
            finalAmountCents,
            status,
            notes: input.notes ?? null,
          },
          select: paymentSelect,
        });
        const created = toDTO(row);
        await recordAudit(tx, ctx, audit(created));
        return created;
      });
      return { ok: true, payment };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { ok: false, reason: 'duplicate' };
      }
      throw e;
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    input: PaymentUpdateInput,
    audit: AuditUpdateBuilder<PaymentDTO, PaymentAuditField>,
  ): Promise<PaymentUpdateResult> {
    const db = forTenant(ctx);

    // The audit row goes in the same transaction as the write (#188). The row
    // is locked and read first: to record which fields changed (#186), and so
    // the amounts settle() works from cannot change underneath it.
    return db.$transaction(async (tx): Promise<PaymentUpdateResult> => {
      await lockRow(tx, 'payments', id, ctx.tenantId);

      // Los montos existentes hacen falta para recalcular finalAmountCents cuando
      // el update trae solo uno de los dos. El estado, para que settle() sepa
      // si puede eximir: solo un PENDING se exime solo.
      const existing = await tx.payment.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: paymentSelect,
      });
      if (!existing) return { ok: false, reason: 'not_found' };

      // Mismo criterio que en create: el paquete debe ser del tenant y del
      // paciente del pago.
      if (input.packageId) {
        const pkg = await tx.sessionPackage.findFirst({
          where: { id: input.packageId, patientId: existing.patientId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!pkg) return { ok: false, reason: 'package_not_found' };
      }

      const newBase = input.baseAmountCents ?? Number(existing.baseAmountCents);
      const newDiscount = input.discountCents ?? Number(existing.discountCents);

      // Un descuento mayor al monto base dejaría finalAmountCents negativo: un cobro
      // que devuelve plata. Se valida acá y no en el schema de la ruta porque el
      // PATCH es parcial — mandar solo `discountCents` se compara contra el monto
      // base guardado, que Zod no conoce (issue #73).
      if (newDiscount > newBase) return { ok: false, reason: 'invalid_amounts' };

      // Un descuento que lleva el cobro a 0 lo exime, pero solo si estaba
      // PENDING: ni un PAID (ahí entró plata) ni un WAIVED puesto a mano se
      // tocan. Un `status` explícito en el body gana sobre lo derivado — quien
      // lo manda está diciendo qué quiere.
      const { finalAmountCents, status } = settle(newBase, newDiscount, existing.status);
      const finalStatus = input.status ?? status;

      // How and when the money came in exist exactly while the payment is PAID
      // (a CHECK in the database). Leaving PAID clears them: a payment marked
      // by mistake leaves no trace of money that never came in. Becoming PAID
      // without a date records now.
      let method: PaymentDTO['method'];
      let paidAt: Date | null;
      if (finalStatus === 'PAID') {
        method = input.method !== undefined ? input.method : existing.method;
        paidAt =
          input.paidAt !== undefined
            ? input.paidAt
            : (existing.paidAt ?? new Date());
        if (!method) return { ok: false, reason: 'paid_without_method' };
        if (!paidAt) return { ok: false, reason: 'paid_without_date' };
      } else {
        if (input.method || input.paidAt) return { ok: false, reason: 'payment_data_without_paid' };
        method = null;
        paidAt = null;
      }

      const row = await tx.payment.update({
        where: { id, tenantId: ctx.tenantId },
        data: {
          ...(input.baseAmountCents !== undefined && { baseAmountCents: input.baseAmountCents }),
          ...(input.discountCents !== undefined && { discountCents: input.discountCents }),
          finalAmountCents,
          status: finalStatus,
          method,
          paidAt,
          ...(input.packageId !== undefined && { packageId: input.packageId }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
        select: paymentSelect,
      });
      const updated = toDTO(row);
      const changed = nonEmpty(changedFields(toDTO(existing), updated, AUDIT_FIELDS));
      if (changed) await recordAudit(tx, ctx, audit(updated, changed));
      return { ok: true, payment: updated };
    });
  },
};
