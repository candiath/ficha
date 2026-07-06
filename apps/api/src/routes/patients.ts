import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';
import { auditLogRepo } from '../repositories';

const router = Router();

// Campos que se exponen en las respuestas. tenantId se excluye
// intencionalmente: es un detalle de implementación interno.
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

// z.coerce.date() convierte strings ISO / 'YYYY-MM-DD' a Date automáticamente.
const PatientCreateSchema = z.object({
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  birthDate: z.coerce.date().optional().nullable(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  phone: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
  referringDoctor: z.string().optional().nullable(),
  insuranceName: z.string().optional().nullable(),
  insuranceNumber: z.string().optional().nullable(),
  insurancePlan: z.string().optional().nullable(),
});

const PatientUpdateSchema = PatientCreateSchema.partial();

// GET /api/patients
router.get('/', async (_req, res) => {
  const patients = await prisma.patient.findMany({
    where: { tenantId: DEV_CONTEXT.tenantId, deletedAt: null },
    select: patientSelect,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: patients });
});

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  const patient = await prisma.patient.findFirst({
    where: { id: req.params.id, tenantId: DEV_CONTEXT.tenantId, deletedAt: null },
    select: patientSelect,
  });

  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  res.json({ data: patient });
});

// POST /api/patients
router.post('/', async (req, res) => {
  const body = PatientCreateSchema.parse(req.body);

  const patient = await prisma.patient.create({
    data: { ...body, tenantId: DEV_CONTEXT.tenantId },
    select: patientSelect,
  });

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: patient.id,
      entity: 'PATIENT',
      entityId: patient.id,
      action: 'CREATED',
      description: `Paciente registrado en el sistema`,
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data: patient });
});

// PATCH /api/patients/:id
router.patch('/:id', async (req, res) => {
  const body = PatientUpdateSchema.parse(req.body);

  // Verificar existencia + pertenencia al tenant antes de actualizar.
  // Nunca usar findUnique solo por id: un tenant podría adivinar IDs ajenos.
  const existing = await prisma.patient.findFirst({
    where: { id: req.params.id, tenantId: DEV_CONTEXT.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const patient = await prisma.patient.update({
    where: { id: req.params.id },
    data: body,
    select: patientSelect,
  });

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: patient.id,
      entity: 'PATIENT',
      entityId: patient.id,
      action: 'UPDATED',
      description: 'Ficha del paciente actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: patient });
});

// DELETE /api/patients/:id
// Borrado lógico: se marca deletedAt en vez de eliminar la fila, para no
// perder historia clínica ni romper las FKs de sesiones, pagos y auditoría.
router.delete('/:id', async (req, res) => {
  const existing = await prisma.patient.findFirst({
    where: { id: req.params.id, tenantId: DEV_CONTEXT.tenantId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  await prisma.patient.update({
    where: { id: req.params.id },
    data: { deletedAt: new Date() },
  });

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: req.params.id,
      entity: 'PATIENT',
      entityId: req.params.id,
      action: 'DELETED',
      description: 'Paciente eliminado (borrado lógico)',
    })
    .catch((err) => console.error('[audit]', err));

  res.status(204).send();
});

export default router;
