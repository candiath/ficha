import { Router } from 'express';
import { z } from 'zod';
import {
  OptionalDateSchema,
  OptionalTextSchema,
  optionalEnum,
  requiredText,
} from '../lib/validation';
import { patientRepo } from '../repositories';
import { idParam } from '../middlewares/idParam';

// Las queries viven en patientRepo, que aplica la política de borrado lógico
// (solo pacientes vigentes) en un único lugar; esta ruta queda en HTTP puro:
// validar el body, mapear null a 404 y registrar auditoría.
const router = Router();
router.param('id', idParam('Paciente no encontrado'));

// Los campos opcionales usan los schemas compartidos: un "" del formulario
// entra como null y el campo ausente no se toca (lib/validation.ts).
const PatientCreateSchema = z.object({
  firstName: requiredText(1, 'El nombre es obligatorio'),
  lastName: requiredText(1, 'El apellido es obligatorio'),
  birthDate: OptionalDateSchema,
  sex: optionalEnum(['MALE', 'FEMALE', 'OTHER']),
  phone: OptionalTextSchema,
  occupation: OptionalTextSchema,
  referringDoctor: OptionalTextSchema,
  insuranceName: OptionalTextSchema,
  insuranceNumber: OptionalTextSchema,
  insurancePlan: OptionalTextSchema,
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

  const patient = await patientRepo.create(req.context, body, (p) => ({
    action: 'PATIENT_CREATED',
    patientId: p.id,
    entityId: p.id,
    params: {},
  }));

  res.status(201).json({ data: patient });
});

// PATCH /api/patients/:id
router.patch('/:id', async (req, res) => {
  const body = PatientUpdateSchema.parse(req.body);

  // null = no existe, es de otro tenant o está borrado: mismo 404 en los
  // tres casos, sin revelar cuál fue.
  const patient = await patientRepo.update(req.context, req.params.id, body, (p, changedFields) => ({
    action: 'PATIENT_UPDATED',
    patientId: p.id,
    entityId: p.id,
    params: { changedFields },
  }));

  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  res.json({ data: patient });
});

// DELETE /api/patients/:id
// Borrado lógico: se marca deletedAt en vez de eliminar la fila, para no
// perder historia clínica ni romper las FKs de sesiones, pagos y auditoría.
router.delete('/:id', async (req, res) => {
  const deleted = await patientRepo.softDelete(req.context, req.params.id, {
    action: 'PATIENT_DELETED',
    patientId: req.params.id,
    entityId: req.params.id,
    params: {},
  });

  if (!deleted) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  res.status(204).send();
});

export default router;
