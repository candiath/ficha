import { Router } from 'express';
import { z } from 'zod';
import { revisionReasonFields } from '@ficha/shared';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import { OptionalTextSchema } from '../lib/validation';
import { episodeRepo, evaluationRepo } from '../repositories';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes/:episodeId/evaluation
// Las queries viven en evaluationRepo; acá queda el HTTP: validar el body,
// exigir que el episodio exista y registrar auditoría.
const router = Router({ mergeParams: true });

// Strict: a field that is not the evaluation's is a 400, not dropped in
// silence (the RPG fields and the pain's onset left it in #238).
const EvaluationSchema = z.strictObject({
  patientNarrative: OptionalTextSchema,
  otherHistory: OptionalTextSchema,
  notes: OptionalTextSchema,
  retractionMap: z.unknown().optional().nullable(),
  physicalActivity: OptionalTextSchema,
  painFrequency: OptionalTextSchema,
  evaScale: z.number().min(0).max(10).optional().nullable(),
  // The version the form loaded, 0 before the first evaluation. A correction
  // says why; the first evaluation needs no reason, so the repository decides.
  expectedVersion: ExpectedVersionSchema,
  reason: revisionReasonFields.reason.optional(),
  reasonNote: revisionReasonFields.reasonNote,
});

// GET /api/patients/:patientId/episodes/:episodeId/evaluation
router.get<Params>('/', async (req, res) => {
  if (!(await episodeRepo.exists(req.context, req.params.patientId, req.params.episodeId))) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const evaluation = await evaluationRepo.getByEpisode(
    req.context,
    req.params.patientId,
    req.params.episodeId,
  );

  res.json({ data: evaluation ?? null });
});

// PUT /api/patients/:patientId/episodes/:episodeId/evaluation
// Upsert: crea si no existe, actualiza si ya existe.
router.put<Params>('/', async (req, res) => {
  if (!(await episodeRepo.exists(req.context, req.params.patientId, req.params.episodeId))) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const body = EvaluationSchema.parse(req.body);

  const result = await evaluationRepo.upsert(
    req.context,
    req.params.patientId,
    req.params.episodeId,
    body,
    ({ evaluation: e }, changedFields) =>
      changedFields
        ? {
            action: 'EVALUATION_UPDATED',
            patientId: req.params.patientId,
            entityId: e.id,
            // The repository refuses a correction with no reason before asking.
            params: { changedFields, reason: body.reason! },
          }
        : { action: 'EVALUATION_CREATED', patientId: req.params.patientId, entityId: e.id, params: {} },
  );

  if (!result.ok) {
    if (result.reason === 'stale') {
      res.status(409).json(STALE_EDIT);
      return;
    }
    res.status(400).json({ error: 'Elegí el motivo del cambio' });
    return;
  }

  res.json({ data: result.evaluation });
});

export default router;
