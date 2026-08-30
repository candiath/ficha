import { Router } from 'express';
import { z } from 'zod';
import type { PaymentStatus } from '@prisma/client';
import { auditLogRepo, paymentRepo } from '../repositories';

// Las queries, la derivación del paciente desde la sesión, el cálculo de
// finalAmount y la unicidad pago-por-sesión viven en paymentRepo; acá queda
// el HTTP: validar el body, resolver paidAt y mapear reasons a status codes.
const router = Router();

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

// GET /api/payments?patientId=xxx&status=PENDING
router.get('/', async (req, res) => {
  const patientId = req.query.patientId as string | undefined;
  const status = req.query.status as PaymentStatus | undefined;

  const payments = await paymentRepo.list(req.context, { patientId, status });
  res.json({ data: payments });
});

// GET /api/payments/last-base-price
// Último baseAmount de un pago sin descuento ni paquete; amount null si es
// más viejo que el umbral de vigencia (la política vive en el repo).
router.get('/last-base-price', async (req, res) => {
  const data = await paymentRepo.lastBasePrice(req.context);
  res.json({ data });
});

// POST /api/payments
router.post('/', async (req, res) => {
  const body = PaymentCreateSchema.parse(req.body);

  const result = await paymentRepo.create(req.context, body);

  if (!result.ok) {
    switch (result.reason) {
      case 'session_not_found':
        res.status(404).json({ error: 'Sesión no encontrada' });
        return;
      case 'package_not_found':
        res.status(404).json({ error: 'Paquete no encontrado' });
        return;
      case 'duplicate':
        res.status(409).json({ error: 'Ya existe un pago para esta sesión' });
        return;
    }
  }

  res.status(201).json({ data: result.payment });

  auditLogRepo
    .create(req.context, {
      patientId: result.payment.patientId,
      entity: 'PAYMENT',
      entityId: result.payment.id,
      action: 'CREATED',
      description: `Cobro registrado — $${result.payment.finalAmount}`,
    })
    .catch((err) => console.error('[audit]', err));
});

// PATCH /api/payments/:id
router.patch('/:id', async (req, res) => {
  const body = PaymentUpdateSchema.parse(req.body);

  // Si se marca como PAID y no hay paidAt, se registra ahora. Se resuelve acá
  // porque depende de distinguir "ausente" de null en el body (HTTP puro).
  const paidAt =
    body.paidAt !== undefined
      ? body.paidAt
        ? new Date(body.paidAt)
        : null
      : body.status === 'PAID'
        ? new Date()
        : undefined;

  const result = await paymentRepo.update(req.context, req.params.id, {
    baseAmount: body.baseAmount,
    discount: body.discount,
    status: body.status,
    method: body.method,
    paidAt,
    packageId: body.packageId,
    notes: body.notes,
  });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Pago no encontrado' });
      return;
    }
    res.status(404).json({ error: 'Paquete no encontrado' });
    return;
  }

  res.json({ data: result.payment });

  const statusDesc = body.status ? ` — Estado: ${body.status}` : '';
  auditLogRepo
    .create(req.context, {
      patientId: result.payment.patientId,
      entity: 'PAYMENT',
      entityId: result.payment.id,
      action: 'UPDATED',
      description: `Cobro actualizado${statusDesc}`,
    })
    .catch((err) => console.error('[audit]', err));
});

export default router;
