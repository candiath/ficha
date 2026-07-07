import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { auditLogRepo } from '../repositories';
import type { TenantContext } from '../repositories/types';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes/:episodeId/evaluation
const router = Router({ mergeParams: true });

const evaluationSelect = {
  id: true,
  patientId: true,
  episodeId: true,
  globalPosture: true,
  breathingPattern: true,
  medicalHistory: true,
  reasonForConsultation: true,
  notes: true,
  morphotype: true,
  retractionMap: true,
  footEvaluation: true,
  breathingPatternDetail: true,
  flexibilityNotes: true,
  physicalActivity: true,
  painAppearanceMoment: true,
  painFrequency: true,
  familyPainAppearance: true,
  familyPainDisappearance: true,
  postureFamilies: true,
  evaScale: true,
  evaluatedAt: true,
  updatedAt: true,
} as const;

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
  familyPainAppearance: z.unknown().optional().nullable(),
  familyPainDisappearance: z.unknown().optional().nullable(),
  postureFamilies: z.record(z.string(), z.string()).optional().nullable(),
  evaScale: z.number().min(0).max(10).optional().nullable(),
});

async function getEpisode(ctx: TenantContext, patientId: string, episodeId: string) {
  return prisma.clinicalEpisode.findFirst({
    where: { id: episodeId, patientId, tenantId: ctx.tenantId },
    select: { id: true },
  });
}

// GET /api/patients/:patientId/episodes/:episodeId/evaluation
router.get<Params>('/', async (req, res) => {
  const episode = await getEpisode(req.context, req.params.patientId, req.params.episodeId);
  if (!episode) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const evaluation = await prisma.initialEvaluation.findUnique({
    where: { episodeId: req.params.episodeId },
    select: evaluationSelect,
  });

  res.json({ data: evaluation ?? null });
});

// PUT /api/patients/:patientId/episodes/:episodeId/evaluation
// Upsert: crea si no existe, actualiza si ya existe.
router.put<Params>('/', async (req, res) => {
  const episode = await getEpisode(req.context, req.params.patientId, req.params.episodeId);
  if (!episode) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const body = EvaluationSchema.parse(req.body);

  const evalExists = await prisma.initialEvaluation.findUnique({
    where: { episodeId: req.params.episodeId },
    select: { id: true },
  });

  const evaluation = await prisma.initialEvaluation.upsert({
    where: { episodeId: req.params.episodeId },
    create: {
      ...body,
      retractionMap: body.retractionMap as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainAppearance: body.familyPainAppearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainDisappearance: body.familyPainDisappearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      postureFamilies: body.postureFamilies ?? Prisma.JsonNull,
      patientId: req.params.patientId,
      episodeId: req.params.episodeId,
      tenantId: req.context.tenantId,
    },
    update: {
      ...body,
      retractionMap: body.retractionMap as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainAppearance: body.familyPainAppearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainDisappearance: body.familyPainDisappearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      postureFamilies: body.postureFamilies ?? Prisma.JsonNull,
    },
    select: evaluationSelect,
  });

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'EVALUATION',
      entityId: evaluation.id,
      action: evalExists ? 'UPDATED' : 'CREATED',
      description: evalExists
        ? 'Evaluación inicial actualizada'
        : 'Evaluación inicial registrada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: evaluation });
});

export default router;
