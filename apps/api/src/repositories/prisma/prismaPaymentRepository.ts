import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  LastBasePrice,
  PaymentCreateInput,
  PaymentCreateResult,
  PaymentDTO,
  PaymentListFilters,
  PaymentRepository,
  PaymentUpdateInput,
  PaymentUpdateResult,
} from '../paymentRepository';

// Días máximos de antigüedad para considerar vigente el último precio base.
// Cambiar acá cuando se quiera hacer configurable.
const LAST_BASE_PRICE_STALENESS_DAYS = 90;

const paymentSelect = {
  id: true,
  patientId: true,
  sessionId: true,
  packageId: true,
  baseAmount: true,
  discount: true,
  finalAmount: true,
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

type Decimalish = { toString(): string };

type PaymentRow = {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmount: Decimalish;
  discount: Decimalish;
  finalAmount: Decimalish;
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

function toDTO(row: PaymentRow): PaymentDTO {
  return {
    ...row,
    baseAmount: Number(row.baseAmount),
    discount: Number(row.discount),
    finalAmount: Number(row.finalAmount),
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
      where: { discount: 0, packageId: null },
      select: { baseAmount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;

    const ageInDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
    const isStale = ageInDays > LAST_BASE_PRICE_STALENESS_DAYS;

    return {
      amount: isStale ? null : Number(row.baseAmount),
      date: row.createdAt.toISOString(),
      isStale,
    };
  },

  async create(ctx: TenantContext, input: PaymentCreateInput): Promise<PaymentCreateResult> {
    const db = forTenant(ctx);

    // El paciente se deriva de la sesión: la sesión debe ser del tenant.
    const session = await db.session.findFirst({
      where: { id: input.sessionId },
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

    try {
      const row = await db.payment.create({
        data: {
          patientId: session.patientId,
          sessionId: input.sessionId,
          packageId: input.packageId ?? null,
          baseAmount: input.baseAmount,
          discount: input.discount,
          finalAmount: input.baseAmount - input.discount,
          notes: input.notes ?? null,
        },
        select: paymentSelect,
      });
      return { ok: true, payment: toDTO(row) };
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
  ): Promise<PaymentUpdateResult> {
    const db = forTenant(ctx);

    // Los montos existentes hacen falta para recalcular finalAmount cuando
    // el update trae solo uno de los dos.
    const existing = await db.payment.findFirst({
      where: { id },
      select: { baseAmount: true, discount: true, patientId: true },
    });
    if (!existing) return { ok: false, reason: 'not_found' };

    // Mismo criterio que en create: el paquete debe ser del tenant y del
    // paciente del pago.
    if (input.packageId) {
      const pkg = await db.sessionPackage.findFirst({
        where: { id: input.packageId, patientId: existing.patientId },
        select: { id: true },
      });
      if (!pkg) return { ok: false, reason: 'package_not_found' };
    }

    const newBase = input.baseAmount ?? Number(existing.baseAmount);
    const newDiscount = input.discount ?? Number(existing.discount);

    const row = await db.payment.update({
      where: { id },
      data: {
        ...(input.baseAmount !== undefined && { baseAmount: input.baseAmount }),
        ...(input.discount !== undefined && { discount: input.discount }),
        finalAmount: newBase - newDiscount,
        ...(input.status !== undefined && { status: input.status }),
        ...(input.method !== undefined && { method: input.method }),
        ...(input.paidAt !== undefined && { paidAt: input.paidAt }),
        ...(input.packageId !== undefined && { packageId: input.packageId }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      select: paymentSelect,
    });
    return { ok: true, payment: toDTO(row) };
  },
};
