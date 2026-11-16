import { Router } from 'express';
import { z } from 'zod';
import { partialDateSchema, revisionReasonFields, revisionReasonSchema } from '@ficha/shared';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import { requiredText } from '../lib/validation';
import { patientAntecedentRepo } from '../repositories';
import { idParam } from '../middlewares/idParam';
import { revisionRoutes } from './revisions';

type ParentParams = { patientId: string };
type AntecedentParams = { patientId: string; antecedentId: string };

// Mounted at /api/patients/:patientId/antecedents: the patient's history
// ("Antecedentes", #238). The queries live in patientAntecedentRepo; here, the
// HTTP: validate the body, require a current patient, record the audit.
const router = Router({ mergeParams: true });
router.param('antecedentId', idParam('Antecedente no encontrado'));

const KINDS = ['FRACTURE', 'SURGERY', 'TRAUMA', 'DIAGNOSIS', 'PAIN_ONSET', 'OTHER'] as const;

// A date the patient lived cannot be in the future. A day of margin for the
// clinic's time zone, ahead of UTC or behind it.
const notInTheFuture = partialDateSchema.refine(
  (d) => new Date(`${d.date}T00:00:00.000Z`).getTime() <= Date.now() + 24 * 60 * 60 * 1000,
  { error: 'La fecha no puede ser futura', path: ['date'] },
);

const AntecedentSchema = z.strictObject({
  kind: z.enum(KINDS),
  description: requiredText(2, 'Describí el antecedente'),
  // null: she does not know when.
  occurred: notInTheFuture.nullable(),
});

// An edit is a correction of the record: it says why (SPEC-clinical-revisions.md
// §4), and which version it was made over, so a stale form gets a 409.
const AntecedentUpdateSchema = AntecedentSchema.partial().extend({
  expectedVersion: ExpectedVersionSchema,
  ...revisionReasonFields,
});

// GET /api/patients/:patientId/antecedents
router.get<ParentParams>('/', async (req, res) => {
  res.json({ data: await patientAntecedentRepo.listByPatient(req.context, req.params.patientId) });
});

// POST /api/patients/:patientId/antecedents
router.post<ParentParams>('/', async (req, res) => {
  const input = AntecedentSchema.parse(req.body);

  const antecedent = await patientAntecedentRepo.create(req.context, req.params.patientId, input, (e) => ({
    action: 'PATIENT_ANTECEDENT_RECORDED',
    patientId: req.params.patientId,
    entityId: e.id,
    params: { kind: e.kind },
  }));

  res.status(201).json({ data: antecedent });
});

// PATCH /api/patients/:patientId/antecedents/:antecedentId
router.patch<AntecedentParams>('/:antecedentId', async (req, res) => {
  const { reason, ...input } = AntecedentUpdateSchema.parse(req.body);

  const result = await patientAntecedentRepo.update(
    req.context,
    req.params.patientId,
    req.params.antecedentId,
    input,
    (e, changedFields) => ({
      action: 'PATIENT_ANTECEDENT_UPDATED',
      patientId: req.params.patientId,
      entityId: e.id,
      params: { kind: e.kind, changedFields, reason },
    }),
  );

  if (!result.ok) {
    // Missing, deleted or another patient's: the same 404, without saying which.
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Antecedente no encontrado' });
      return;
    }
    res.status(409).json(STALE_EDIT);
    return;
  }
  res.json({ data: result.antecedent });
});

// POST /api/patients/:patientId/antecedents/:antecedentId/annul
// An antecedent entered by mistake is annulled, never deleted
// (SPEC-clinical-revisions.md §8): it stays in the history struck through. The
// reason is required. There is no restore route yet.
router.post<AntecedentParams>('/:antecedentId/annul', async (req, res) => {
  const { reason, reasonNote } = revisionReasonSchema.parse(req.body);

  const result = await patientAntecedentRepo.annul(
    req.context,
    req.params.patientId,
    req.params.antecedentId,
    { reasonNote },
    (e) => ({
      action: 'PATIENT_ANTECEDENT_ANNULLED',
      patientId: req.params.patientId,
      entityId: e.id,
      params: { kind: e.kind, reason },
    }),
  );

  // Missing, already annulled or another patient's: the same 404.
  if (result === 'not_found') {
    res.status(404).json({ error: 'Antecedente no encontrado' });
    return;
  }
  res.status(204).send();
});

// Its history (SPEC-clinical-revisions.md §7).
router.use('/:antecedentId/revisions', revisionRoutes((p) => ({ aggregate: 'patientAntecedent', antecedentId: p.antecedentId }), 'Antecedente no encontrado'));

export default router;
