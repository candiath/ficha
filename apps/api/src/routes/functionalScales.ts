import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';

// Montado en /api/patients/:patientId/scales
const router = Router({ mergeParams: true });

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Oswestry Disability Index (ODI): 10 secciones, 0–5 cada una */
function scoreOswestry(responses: Record<string, number>): { score: number; interpretation: string } {
  const total = Object.values(responses).reduce((s, v) => s + v, 0);
  const questionCount = Object.keys(responses).length;
  const maxPossible = questionCount * 5;
  const pct = Math.round((total / maxPossible) * 100);

  let interpretation: string;
  if (pct <= 20) interpretation = 'Mínima discapacidad (0–20%)';
  else if (pct <= 40) interpretation = 'Discapacidad moderada (21–40%)';
  else if (pct <= 60) interpretation = 'Discapacidad severa (41–60%)';
  else if (pct <= 80) interpretation = 'Discapacidad muy severa (61–80%)';
  else interpretation = 'Discapacidad máxima (81–100%)';

  return { score: pct, interpretation };
}

/** Neck Disability Index (NDI): 10 secciones, 0–5 cada una (misma lógica que ODI) */
function scoreNDI(responses: Record<string, number>): { score: number; interpretation: string } {
  const total = Object.values(responses).reduce((s, v) => s + v, 0);
  const questionCount = Object.keys(responses).length;
  const maxPossible = questionCount * 5;
  const pct = Math.round((total / maxPossible) * 100);

  let interpretation: string;
  if (pct <= 4) interpretation = 'Sin discapacidad (0–4%)';
  else if (pct <= 14) interpretation = 'Discapacidad leve (5–14%)';
  else if (pct <= 24) interpretation = 'Discapacidad moderada (15–24%)';
  else if (pct <= 34) interpretation = 'Discapacidad severa (25–34%)';
  else interpretation = 'Discapacidad completa (≥35%)';

  return { score: pct, interpretation };
}

// ── Zod ──────────────────────────────────────────────────────────────────────

const ResponsesSchema = z.record(z.string(), z.number().int().min(0).max(5));

const ScaleCreateSchema = z.object({
  scaleType: z.enum(['OSWESTRY', 'NDI']),
  responses: ResponsesSchema,
  appliedAt: z.string().datetime({ offset: true }).optional(),
});

type Params = { patientId: string; scaleId: string };

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/patients/:patientId/scales
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const { tenantId } = DEV_CONTEXT;
  const { patientId } = req.params;

  const scales = await prisma.functionalScale.findMany({
    where: { tenantId, patientId },
    orderBy: { appliedAt: 'desc' },
    select: {
      id: true,
      scaleType: true,
      score: true,
      interpretation: true,
      appliedAt: true,
      createdAt: true,
    },
  });

  res.json({ data: scales });
});

// GET /api/patients/:patientId/scales/:scaleId
router.get<Params>('/:scaleId', async (req, res) => {
  const { tenantId } = DEV_CONTEXT;
  const { patientId, scaleId } = req.params;

  const scale = await prisma.functionalScale.findFirst({
    where: { id: scaleId, tenantId, patientId },
  });

  if (!scale) {
    res.status(404).json({ error: 'Escala no encontrada' });
    return;
  }

  res.json({ data: scale });
});

// POST /api/patients/:patientId/scales
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const { tenantId } = DEV_CONTEXT;
  const { patientId } = req.params;
  const body = ScaleCreateSchema.parse(req.body);

  const responses = body.responses as Record<string, number>;
  const { score, interpretation } =
    body.scaleType === 'OSWESTRY'
      ? scoreOswestry(responses)
      : scoreNDI(responses);

  const scale = await prisma.functionalScale.create({
    data: {
      tenantId,
      patientId,
      scaleType: body.scaleType,
      responses,
      score,
      interpretation,
      ...(body.appliedAt && { appliedAt: new Date(body.appliedAt) }),
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      tenantId,
      patientId,
      entity: 'EVALUATION',
      entityId: scale.id,
      action: 'CREATED',
      description: `Escala ${body.scaleType} aplicada — score ${score}%`,
    },
  });

  res.status(201).json({ data: scale });
});

// DELETE /api/patients/:patientId/scales/:scaleId
router.delete<Params>('/:scaleId', async (req, res) => {
  const { tenantId } = DEV_CONTEXT;
  const { patientId, scaleId } = req.params;

  const existing = await prisma.functionalScale.findFirst({
    where: { id: scaleId, tenantId, patientId },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Escala no encontrada' });
    return;
  }

  await prisma.functionalScale.delete({
    where: { id: scaleId },
  });

  res.status(204).send();
});

export default router;
