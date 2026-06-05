import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';
import { auditLogRepo } from '../repositories';

type ParentParams = { patientId: string };
type SessionParams = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions
const router = Router({ mergeParams: true });

const sessionSelect = {
  id: true,
  patientId: true,
  episodeId: true,
  sessionType: true,
  sessionDate: true,
  preSesionState: true,
  reEvaluationNotes: true,
  patientResponse: true,
  painScaleBefore: true,
  painScaleAfter: true,
  observations: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SessionCreateSchema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  sessionDate: z.string().datetime(),
  episodeId: z.string().uuid().optional().nullable(),
  preSesionState: z.string().optional().nullable(),
  reEvaluationNotes: z.string().optional().nullable(),
  patientResponse: z.string().optional().nullable(),
  painScaleBefore: z.number().int().min(0).max(10).optional().nullable(),
  painScaleAfter: z.number().int().min(0).max(10).optional().nullable(),
  observations: z.string().optional().nullable(),
});

const SessionUpdateSchema = SessionCreateSchema.partial();

async function getPatient(patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, tenantId: DEV_CONTEXT.tenantId },
    select: { id: true },
  });
}

// Sin auth: obtenemos el primer usuario del tenant como userId.
async function getDevUserId(): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { tenantId: DEV_CONTEXT.tenantId },
    select: { id: true },
  });
  return user.id;
}

// GET /api/patients/:patientId/sessions
// Acepta ?episodeId= para filtrar por episodio.
router.get<ParentParams>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;

  const sessions = await prisma.session.findMany({
    where: {
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
      ...(episodeId ? { episodeId } : {}),
    },
    orderBy: { sessionDate: 'desc' },
    select: sessionSelect,
  });

  res.json({ data: sessions });
});

// GET /api/patients/:patientId/sessions/:sessionId
router.get<SessionParams>('/:sessionId', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const session = await prisma.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
    },
    select: sessionSelect,
  });

  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({ data: session });
});

// POST /api/patients/:patientId/sessions
router.post<ParentParams>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const userId = await getDevUserId();
  const body = SessionCreateSchema.parse(req.body);

  const session = await prisma.session.create({
    data: {
      ...body,
      sessionDate: new Date(body.sessionDate),
      patientId: req.params.patientId,
      episodeId: body.episodeId ?? null,
      tenantId: DEV_CONTEXT.tenantId,
      userId,
    },
    select: sessionSelect,
  });

  const sessionTypeDesc: Record<string, string> = {
    SESSION: 'Sesión RPG registrada',
    NOTE: 'Nota clínica registrada',
    DISCHARGE: 'Alta registrada',
  };
  const painSuffix =
    body.painScaleBefore != null && body.painScaleAfter != null
      ? ` — Dolor ${body.painScaleBefore} → ${body.painScaleAfter}`
      : '';
  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: req.params.patientId,
      userId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'CREATED',
      description: `${sessionTypeDesc[body.sessionType ?? 'SESSION'] ?? 'Sesión registrada'}${painSuffix}`,
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data: session });
});

// PATCH /api/patients/:patientId/sessions/:sessionId
router.patch<SessionParams>('/:sessionId', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const existing = await prisma.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
    },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  const body = SessionUpdateSchema.parse(req.body);
  const updateData = {
    ...body,
    ...(body.sessionDate ? { sessionDate: new Date(body.sessionDate) } : {}),
  };

  const session = await prisma.session.update({
    where: { id: req.params.sessionId },
    data: updateData,
    select: sessionSelect,
  });

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: req.params.patientId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'UPDATED',
      description: 'Sesión actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: session });
});

export default router;
