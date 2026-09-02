import { Router } from 'express';
import { familyPainSchema, postureFamiliesSchema } from '@ficha/shared';
import { z } from 'zod';
import { auditLogRepo, episodeRepo, evaluationRepo } from '../repositories';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes/:episodeId/evaluation
// Las queries viven en evaluationRepo; acá queda el HTTP: validar el body,
// exigir que el episodio exista y registrar auditoría.
const router = Router({ mergeParams: true });

const EvaluationSchema = z.object({
  reasonForConsultation: z.string().optional().nullable(),
  medicalHistory: z.string().optional().nullable(),
  globalPosture: z.string().optional().nullable(),
  breathingPattern: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  morphotype: z.string().optional().nullable(),
  retractionMap: z.unknown().optional().nullable(),
  footEvaluation: z.string().optional().nullable(),
  breathingPatternDetail: z.string().optional().nullable(),
  flexibilityNotes: z.string().optional().nullable(),
  physicalActivity: z.string().optional().nullable(),
  painAppearanceMoment: z.string().optional().nullable(),
  painFrequency: z.string().optional().nullable(),
  // Los tres campos de la sección de familias se validan de verdad: su forma
  // vive en @ficha/shared, que es también la que dibuja la grilla en la web.
  familyPainAppearance: familyPainSchema.optional().nullable(),
  familyPainDisappearance: familyPainSchema.optional().nullable(),
  postureFamilies: postureFamiliesSchema.optional().nullable(),
  evaScale: z.number().min(0).max(10).optional().nullable(),
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

  const { evaluation, created } = await evaluationRepo.upsert(
    req.context,
    req.params.patientId,
    req.params.episodeId,
    body,
  );

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'EVALUATION',
      entityId: evaluation.id,
      action: created ? 'CREATED' : 'UPDATED',
      description: created
        ? 'Evaluación inicial registrada'
        : 'Evaluación inicial actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: evaluation });
});

export default router;
