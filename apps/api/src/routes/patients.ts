import { Router } from 'express';
import { z } from 'zod';
import { auditLogRepo, patientRepo } from '../repositories';

// Las queries viven en patientRepo, que aplica la política de borrado lógico
// (solo pacientes vigentes) en un único lugar; esta ruta queda en HTTP puro:
// validar el body, mapear null a 404 y registrar auditoría.
const router = Router();

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
router.get('/', async (req, res) => {
  const patients = await patientRepo.list(req.context);
  res.json({ data: patients });
});

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  const patient = await patientRepo.getById(req.context, req.params.id);

  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  res.json({ data: patient });
});

// POST /api/patients
router.post('/', async (req, res) => {
  const body = PatientCreateSchema.parse(req.body);

  const patient = await patientRepo.create(req.context, body);

  auditLogRepo
    .create(req.context, {
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

  // null = no existe, es de otro tenant o está borrado: mismo 404 en los
  // tres casos, sin revelar cuál fue.
  const patient = await patientRepo.update(req.context, req.params.id, body);

  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  auditLogRepo
    .create(req.context, {
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
  const deleted = await patientRepo.softDelete(req.context, req.params.id);

  if (!deleted) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  auditLogRepo
    .create(req.context, {
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
