import { Router } from 'express';
import { z } from 'zod';
import { functionalScaleRepo, patientRepo } from '../repositories';
import { idParam } from '../middlewares/idParam';

// Montado en /api/patients/:patientId/scales
// El scoring ODI/NDI vive acá (dominio puro); las queries en
// functionalScaleRepo. Cada handler exige paciente vigente vía
// patientRepo.exists — antes esta ruta no validaba el paciente en absoluto,
// a diferencia de episodios/sesiones/paquetes.
const router = Router({ mergeParams: true });
router.param('scaleId', idParam('Escala no encontrada'));

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Oswestry (ODI) and NDI score the same way: 10 sections of 0–5, as a
 * percentage of what the answered sections could add up to. The band that
 * reads the score lives in lib/scaleBands.ts.
 */
function scorePercentage(responses: Record<string, number>): number {
  const total = Object.values(responses).reduce((s, v) => s + v, 0);
  const maxPossible = Object.keys(responses).length * 5;
  return Math.round((total / maxPossible) * 100);
}

// ── Zod ──────────────────────────────────────────────────────────────────────

// At least one answered section: with none, the percentage divides by zero.
const ResponsesSchema = z
  .record(z.string(), z.number().int().min(0).max(5))
  .refine((r) => Object.keys(r).length > 0, { error: 'La escala necesita al menos una respuesta' });

const ScaleCreateSchema = z.object({
  scaleType: z.enum(['OSWESTRY', 'NDI']),
  responses: ResponsesSchema,
  appliedAt: z.string().datetime({ offset: true }).optional(),
});

type Params = { patientId: string; scaleId: string };

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/patients/:patientId/scales
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const scales = await functionalScaleRepo.listByPatient(req.context, req.params.patientId);
  res.json({ data: scales });
});

// GET /api/patients/:patientId/scales/:scaleId
router.get<Params>('/:scaleId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const scale = await functionalScaleRepo.getById(
    req.context,
    req.params.patientId,
    req.params.scaleId,
  );

  if (!scale) {
    res.status(404).json({ error: 'Escala no encontrada' });
    return;
  }

  res.json({ data: scale });
});

// POST /api/patients/:patientId/scales
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = ScaleCreateSchema.parse(req.body);

  const responses = body.responses;
  const score = scorePercentage(responses);

  const scale = await functionalScaleRepo.create(
    req.context,
    req.params.patientId,
    {
      scaleType: body.scaleType,
      responses,
      score,
      ...(body.appliedAt ? { appliedAt: new Date(body.appliedAt) } : {}),
    },
    (s) => ({
      action: 'SCALE_APPLIED',
      patientId: req.params.patientId,
      entityId: s.id,
      params: { scaleType: s.scaleType },
    }),
  );

  res.status(201).json({ data: scale });
});

// DELETE /api/patients/:patientId/scales/:scaleId
router.delete<Params>('/:scaleId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const deleted = await functionalScaleRepo.delete(
    req.context,
    req.params.patientId,
    req.params.scaleId,
  );

  if (!deleted) {
    res.status(404).json({ error: 'Escala no encontrada' });
    return;
  }

  res.status(204).send();
});

export default router;
