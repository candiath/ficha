import { Router } from 'express';
import { z } from 'zod';
import { partialDateSchema } from '@ficha/shared';
import { requiredText } from '../lib/validation';
import { patientEventRepo, patientRepo } from '../repositories';
import { idParam } from '../middlewares/idParam';

type ParentParams = { patientId: string };
type EventParams = { patientId: string; eventId: string };

// Mounted at /api/patients/:patientId/events: the patient's history
// ("Antecedentes", #238). The queries live in patientEventRepo; here, the
// HTTP: validate the body, require a current patient, record the audit.
const router = Router({ mergeParams: true });
router.param('eventId', idParam('Antecedente no encontrado'));

const KINDS = ['FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER'] as const;

// A date the patient lived cannot be in the future. A day of margin for the
// clinic's time zone, ahead of UTC or behind it.
const notInTheFuture = partialDateSchema.refine(
  (d) => new Date(`${d.date}T00:00:00.000Z`).getTime() <= Date.now() + 24 * 60 * 60 * 1000,
  { error: 'La fecha no puede ser futura', path: ['date'] },
);

const EventSchema = z.strictObject({
  kind: z.enum(KINDS),
  description: requiredText(2, 'Describí el antecedente'),
  // null: she does not know when.
  occurred: notInTheFuture.nullable(),
});

const EventUpdateSchema = EventSchema.partial();

// GET /api/patients/:patientId/events
router.get<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }
  res.json({ data: await patientEventRepo.listByPatient(req.context, req.params.patientId) });
});

// POST /api/patients/:patientId/events
router.post<ParentParams>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }
  const input = EventSchema.parse(req.body);

  const event = await patientEventRepo.create(req.context, req.params.patientId, input, (e) => ({
    action: 'PATIENT_EVENT_RECORDED',
    patientId: req.params.patientId,
    entityId: e.id,
    params: { kind: e.kind },
  }));

  res.status(201).json({ data: event });
});

// PATCH /api/patients/:patientId/events/:eventId
router.patch<EventParams>('/:eventId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }
  const input = EventUpdateSchema.parse(req.body);

  const event = await patientEventRepo.update(
    req.context,
    req.params.patientId,
    req.params.eventId,
    input,
    (e, changedFields) => ({
      action: 'PATIENT_EVENT_UPDATED',
      patientId: req.params.patientId,
      entityId: e.id,
      params: { kind: e.kind, changedFields },
    }),
  );

  // Missing, deleted or another patient's: the same 404, without saying which.
  if (!event) {
    res.status(404).json({ error: 'Antecedente no encontrado' });
    return;
  }
  res.json({ data: event });
});

// DELETE /api/patients/:patientId/events/:eventId
router.delete<EventParams>('/:eventId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const result = await patientEventRepo.softDelete(
    req.context,
    req.params.patientId,
    req.params.eventId,
    (e) => ({
      action: 'PATIENT_EVENT_DELETED',
      patientId: req.params.patientId,
      entityId: e.id,
      params: { kind: e.kind },
    }),
  );

  if (result === 'not_found') {
    res.status(404).json({ error: 'Antecedente no encontrado' });
    return;
  }
  res.status(204).send();
});

export default router;
