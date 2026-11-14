import { Router } from 'express';
import { z } from 'zod';
import { DOCUMENT_TYPES, normalizeDocumentNumber, revisionReasonFields } from '@ficha/shared';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import {
  OptionalDateSchema,
  OptionalTextSchema,
  optionalEnum,
  requiredText,
} from '../lib/validation';
import { patientRepo } from '../repositories';
import type { DocumentHolder } from '../repositories/patientRepository';
import { idParam } from '../middlewares/idParam';
import { revisionRoutes } from './revisions';

// Las queries viven en patientRepo, que aplica la política de borrado lógico
// (solo pacientes vigentes) en un único lugar; esta ruta queda en HTTP puro:
// validar el body, mapear null a 404 y registrar auditoría.
const router = Router();
router.param('id', idParam('Paciente no encontrado'));

// Los campos opcionales usan los schemas compartidos: un "" del formulario
// entra como null y el campo ausente no se toca (lib/validation.ts).
const PatientFieldsSchema = z.object({
  firstName: requiredText(1, 'El nombre es obligatorio'),
  lastName: requiredText(1, 'El apellido es obligatorio'),
  birthDate: OptionalDateSchema,
  sex: optionalEnum(['MALE', 'FEMALE', 'OTHER']),
  documentType: optionalEnum(DOCUMENT_TYPES),
  documentNumber: OptionalTextSchema,
  phone: OptionalTextSchema,
  occupation: OptionalTextSchema,
  referringDoctor: OptionalTextSchema,
  insuranceName: OptionalTextSchema,
  insuranceNumber: OptionalTextSchema,
  insurancePlan: OptionalTextSchema,
});

// The document is a type and a number, both or neither, and they travel
// together: a request that names one names the other, so the pair can be
// checked and the number normalized for its type without reading the row.
// The number is stored in its canonical form (packages/shared
// patientDocument.ts): what the clinic's unique key compares.
function withDocument<T extends { documentType?: (typeof DOCUMENT_TYPES)[number] | null; documentNumber?: string | null }>(
  body: T,
  ctx: z.RefinementCtx,
): T {
  const { documentType: type, documentNumber: number } = body;
  if ((type === undefined) !== (number === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: [type === undefined ? 'documentType' : 'documentNumber'],
      message: 'El tipo y el número de documento se envían juntos',
    });
    return body;
  }
  if (type === undefined || number === undefined) return body;
  if (type === null && number === null) return body;
  if (type === null) {
    ctx.addIssue({ code: 'custom', path: ['documentType'], message: 'Elegí el tipo de documento' });
    return body;
  }
  if (number === null) {
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: 'Ingresá el número de documento' });
    return body;
  }
  const normalized = normalizeDocumentNumber(type, number);
  if (!normalized.ok) {
    ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: normalized.error });
    return body;
  }
  return { ...body, documentNumber: normalized.number };
}

const PatientCreateSchema = PatientFieldsSchema.transform(withDocument);

// An edit is a correction of the record: it says why (SPEC-clinical-revisions.md
// §4), even when it changes only contact or coverage, which are not versioned,
// and which version it was made over, so a stale form gets a 409.
const PatientUpdateSchema = PatientFieldsSchema.partial()
  .extend({
    expectedVersion: ExpectedVersionSchema,
    ...revisionReasonFields,
  })
  .transform(withDocument);

// A clinic holds one patient per document. The answer names who has it, so
// the user can open her record or, if she was deleted, restore her.
function documentTaken(holder: DocumentHolder | null) {
  if (!holder) return { error: 'Ya hay un paciente con ese documento' };
  return {
    error: holder.deleted
      ? `Ya hay un paciente con ese documento: ${holder.fullName}, que está eliminado. Restauralo desde Pacientes eliminados.`
      : `Ya hay un paciente con ese documento: ${holder.fullName}`,
    holder,
  };
}

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

  const result = await patientRepo.create(req.context, body, (p) => ({
    action: 'PATIENT_CREATED',
    patientId: p.id,
    entityId: p.id,
    params: {},
  }));

  if (!result.ok) {
    res.status(409).json(documentTaken(result.holder));
    return;
  }

  res.status(201).json({ data: result.patient });
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
    if (result.reason === 'document_taken') {
      res.status(409).json(documentTaken(result.holder));
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
