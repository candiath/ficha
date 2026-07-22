import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PaymentStatus } from '@prisma/client';
import { auditLogRepo } from '../repositories';

const router = Router();

// Días máximos de antigüedad para considerar válido el último precio base.
// HARDCODED_LAST_BASE_PRICE_STALENESS_DAYS: cambiar aquí cuando se quiera hacer configurable.
const HARDCODED_LAST_BASE_PRICE_STALENESS_DAYS = 90;

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

// Sin patientId: el paciente se deriva de la sesión. Aceptarlo del body
// permitía crear pagos apuntando a pacientes de otro tenant (y el GET,
// que incluye patient.fullName, exponía el nombre ajeno).
const PaymentCreateSchema = z.object({
  sessionId: z.string().min(1),
  packageId: z.string().optional().nullable(),
  baseAmount: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});

const PaymentUpdateSchema = z.object({
  baseAmount: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  status: z.enum(['PENDING', 'PAID', 'WAIVED']).optional(),
  method: z.enum(['CASH', 'TRANSFER']).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  packageId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function serializePayment(p: Prisma.PaymentGetPayload<{select: typeof paymentSelect}>) {
  return {
    ...p,
    baseAmount: Number(p.baseAmount),
    discount: Number(p.discount),
    finalAmount: Number(p.finalAmount),
  };
}

// GET /api/payments?patientId=xxx&status=PENDING
router.get('/', async (req, res) => {
  const patientId = req.query.patientId as string | undefined;
  const status = req.query.status as string | undefined;

  const payments = await req.db.payment.findMany({
    where: {
      ...(patientId ? { patientId } : {}),
      ...(status ? { status: status as PaymentStatus } : {}),
    },
    select: paymentSelect,
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: payments.map(serializePayment) });
});

// GET /api/payments/last-base-price
// Devuelve el último baseAmount de un pago sin descuento ni paquete.
// Si tiene más de HARDCODED_LAST_BASE_PRICE_STALENESS_DAYS días, amount = null.
router.get('/last-base-price', async (req, res) => {
  const payment = await req.db.payment.findFirst({
    where: {
      discount: 0,
      packageId: null,
    },
    select: { baseAmount: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) {
    res.json({ data: null });
    return;
  }

  const ageInDays = (Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const isStale = ageInDays > HARDCODED_LAST_BASE_PRICE_STALENESS_DAYS;

  res.json({
    data: {
      amount: isStale ? null : Number(payment.baseAmount),
      date: payment.createdAt,
      isStale,
    },
  });
});

// POST /api/payments
router.post('/', async (req, res) => {
  const body = PaymentCreateSchema.parse(req.body);

  // Verificar que la sesión existe y pertenece al tenant
  const session = await req.db.session.findFirst({
    where: { id: body.sessionId },
    select: { id: true, patientId: true },
  });
  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  // El paquete a debitar debe ser del mismo tenant y del mismo paciente:
  // sin este chequeo se podía descontar sesiones del paquete de otro.
  if (body.packageId) {
    const pkg = await req.db.sessionPackage.findFirst({
      where: {
        id: body.packageId,
        patientId: session.patientId,
      },
      select: { id: true },
    });
    if (!pkg) {
      res.status(404).json({ error: 'Paquete no encontrado' });
      return;
    }
  }

  // Verificar que no exista ya un pago para esta sesión
  const existing = await req.db.payment.findUnique({
    where: { sessionId: body.sessionId },
    select: { id: true },
  });
  if (existing) {
    res.status(409).json({ error: 'Ya existe un pago para esta sesión' });
    return;
  }

  const discount = body.discount ?? 0;
  const finalAmount = body.baseAmount - discount;

  let payment;
  try {
    payment = await req.db.payment.create({
      data: {
        patientId: session.patientId,
        sessionId: body.sessionId,
        packageId: body.packageId ?? null,
        baseAmount: body.baseAmount,
        discount,
        finalAmount,
        notes: body.notes ?? null,
      },
      select: paymentSelect,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return res
        .status(409)
        .json({ error: "La sesión ya tiene un pago registrado" });
    }
    throw e;
  }

  res.status(201).json({ data: serializePayment(payment) });

  auditLogRepo
    .create(req.context, {
      patientId: session.patientId,
      entity: 'PAYMENT',
      entityId: payment.id,
      action: 'CREATED',
      description: `Cobro registrado — $${finalAmount}`,
    })
    .catch((err) => console.error('[audit]', err));
});

// PATCH /api/payments/:id
router.patch('/:id', async (req, res) => {
  const body = PaymentUpdateSchema.parse(req.body);

  const existing = await req.db.payment.findFirst({
    where: { id: req.params.id },
    select: { baseAmount: true, discount: true, patientId: true },
  });
  if (!existing) {
    res.status(404).json({ error: 'Pago no encontrado' });
    return;
  }

  // Mismo chequeo que en el POST: el paquete debe ser del tenant y del
  // paciente del pago.
  if (body.packageId) {
    const pkg = await req.db.sessionPackage.findFirst({
      where: {
        id: body.packageId,
        patientId: existing.patientId,
      },
      select: { id: true },
    });
    if (!pkg) {
      res.status(404).json({ error: 'Paquete no encontrado' });
      return;
    }
  }

  const newBase = body.baseAmount ?? Number(existing.baseAmount);
  const newDiscount = body.discount ?? Number(existing.discount);
  const newFinal = newBase - newDiscount;

  // Si se marca como PAID y no hay paidAt, se registra ahora
  const paidAt =
    body.paidAt !== undefined
      ? body.paidAt
        ? new Date(body.paidAt)
        : null
      : body.status === 'PAID'
        ? new Date()
        : undefined;

  const payment = await req.db.payment.update({
    where: { id: req.params.id },
    data: {
      ...(body.baseAmount !== undefined && { baseAmount: body.baseAmount }),
      ...(body.discount !== undefined && { discount: body.discount }),
      finalAmount: newFinal,
      ...(body.status !== undefined && { status: body.status }),
      ...(body.method !== undefined && { method: body.method }),
      ...(paidAt !== undefined && { paidAt }),
      ...(body.packageId !== undefined && { packageId: body.packageId }),
      ...(body.notes !== undefined && { notes: body.notes }),
    },
    select: paymentSelect,
  });

  res.json({ data: serializePayment(payment) });

  const statusDesc = body.status ? ` — Estado: ${body.status}` : '';
  auditLogRepo
    .create(req.context, {
      patientId: payment.patientId,
      entity: 'PAYMENT',
      entityId: payment.id,
      action: 'UPDATED',
      description: `Cobro actualizado${statusDesc}`,
    })
    .catch((err) => console.error('[audit]', err));
});

export default router;
