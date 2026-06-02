import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';
import { auditLogRepo } from '../repositories';

type Params = { patientId: string };

// Montado en /api/patients/:patientId/evaluation
const router = Router({ mergeParams: true });

const evaluationSelect = {
  id: true,
  patientId: true,
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
  familyPainAppearance: true,
  familyPainDisappearance: true,
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
  familyPainAppearance: z.unknown().optional().nullable(),
  familyPainDisappearance: z.unknown().optional().nullable(),
  evaScale: z.number().min(0).max(10).optional().nullable(),
});

// Verificar que el paciente pertenece al tenant antes de operar.
async function getPatient(patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, tenantId: DEV_CONTEXT.tenantId },
    select: { id: true },
  });
}

// GET /api/patients/:patientId/evaluation
router.get<Params>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const evaluation = await prisma.initialEvaluation.findUnique({
    where: { patientId: req.params.patientId },
    select: evaluationSelect,
  });

  // 200 con data: null si aún no existe — el frontend decide qué mostrar.
  res.json({ data: evaluation ?? null });
});

// PUT /api/patients/:patientId/evaluation
// Upsert: crea si no existe, actualiza si ya existe.
router.put<Params>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EvaluationSchema.parse(req.body);

  const evalExists = await prisma.initialEvaluation.findUnique({
    where: { patientId: req.params.patientId },
    select: { id: true },
  });

  const evaluation = await prisma.initialEvaluation.upsert({
    where: { patientId: req.params.patientId },
    create: {
      ...body,
      retractionMap: body.retractionMap as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainAppearance: body.familyPainAppearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainDisappearance: body.familyPainDisappearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
    },
    update: {
      ...body,
      retractionMap: body.retractionMap as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainAppearance: body.familyPainAppearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
      familyPainDisappearance: body.familyPainDisappearance as Prisma.InputJsonValue ?? Prisma.JsonNull,
    },
    select: evaluationSelect,
  });

  auditLogRepo
    .create(DEV_CONTEXT, {
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
