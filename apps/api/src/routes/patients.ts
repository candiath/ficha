import { Router } from 'express';
import { z } from 'zod';
import { revisionReasonFields } from '@ficha/shared';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import {
  OptionalDateSchema,
  OptionalTextSchema,
  optionalEnum,
  requiredText,
} from '../lib/validation';
import { patientRepo } from '../repositories';
import { idParam } from '../middlewares/idParam';
import { revisionRoutes } from './revisions';

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

// An edit is a correction of the record: it says why (SPEC-clinical-revisions.md
// §4), even when it changes only contact or coverage, which are not versioned,
// and which version it was made over, so a stale form gets a 409.
const PatientUpdateSchema = PatientCreateSchema.partial().extend({
  expectedVersion: ExpectedVersionSchema,
  ...revisionReasonFields,
});

// GET /api/patients
router.get('/', async (req, res) => {
  const patients = await patientRepo.list(req.context);
  res.json({ data: patients });
});

// GET /api/patients/deleted — the clinic's deleted patients, to restore one.
// Names only, like the list. Declared before /:id, which would take it.
router.get('/deleted', async (req, res) => {
  res.json({ data: await patientRepo.listDeleted(req.context) });
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
  const { reason, ...body } = PatientUpdateSchema.parse(req.body);

  const result = await patientRepo.update(req.context, req.params.id, body, (p, changedFields) => ({
    action: 'PATIENT_UPDATED',
    patientId: p.id,
    entityId: p.id,
    params: { changedFields, reason },
  }));

  if (!result.ok) {
    // No existe, es de otro tenant o está borrado: mismo 404 en los tres
    // casos, sin revelar cuál fue.
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Paciente no encontrado' });
      return;
    }
    res.status(409).json(STALE_EDIT);
    return;
  }

  res.json({ data: result.patient });
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

// POST /api/patients/:id/restore — undoes the deletion. Any user of the
// clinic, as deleting is. The record and its appointments come back as they
// were: deleting hid them and changed nothing else.
router.post('/:id/restore', async (req, res) => {
  const restored = await patientRepo.restore(req.context, req.params.id, {
    action: 'PATIENT_RESTORED',
    patientId: req.params.id,
    entityId: req.params.id,
    params: {},
  });

  if (!restored) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  res.status(204).send();
});

// Its history (SPEC-clinical-revisions.md §7).
router.use('/:id/revisions', revisionRoutes(() => ({ aggregate: 'patient' }), 'Paciente no encontrado'));

export default router;
