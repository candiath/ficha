import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditLogRepo } from '../repositories';
import type { TenantContext } from '../repositories/types';

type ParentParams = { patientId: string };
type SessionParams = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions
const router = Router({ mergeParams: true });

// Una sesión puede abordar varios episodios (motivos) a la vez: se devuelven
// como episodeIds para que el cliente trabaje con un arreglo plano.
const sessionSelect = {
  id: true,
  patientId: true,
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
  episodes: { select: { episodeId: true } },
} as const;

type SessionRow = {
  episodes: { episodeId: string }[];
  [key: string]: unknown;
};

// Aplana el pivote a un arreglo de ids de episodio.
function toSessionDTO({ episodes, ...rest }: SessionRow) {
  return { ...rest, episodeIds: episodes.map((e) => e.episodeId) };
}

const SessionCreateSchema = z.object({
  sessionType: z.enum(['SESSION', 'NOTE', 'DISCHARGE']).default('SESSION'),
  sessionDate: z.string().datetime(),
  episodeIds: z.array(z.string().uuid()).optional().default([]),
  preSesionState: z.string().optional().nullable(),
  reEvaluationNotes: z.string().optional().nullable(),
  patientResponse: z.string().optional().nullable(),
  painScaleBefore: z.number().int().min(0).max(10).optional().nullable(),
  painScaleAfter: z.number().int().min(0).max(10).optional().nullable(),
  observations: z.string().optional().nullable(),
});

const SessionUpdateSchema = SessionCreateSchema.partial();

async function getPatient(ctx: TenantContext, patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true },
  });
}

// Los episodeIds vienen del body: sin esta verificación, un connect a ciegas
// permitiría vincular la sesión a episodios de otro paciente o de otro tenant
// (y GET /api/sessions expondría el mainComplaint ajeno).
async function episodesBelongToPatient(
  ctx: TenantContext,
  patientId: string,
  episodeIds: string[],
): Promise<boolean> {
  if (episodeIds.length === 0) return true;
  // Deduplicar antes de contar: con ids repetidos count devolvería menos que
  // length y un request válido se rechazaría por error.
  const uniqueIds = [...new Set(episodeIds)];
  // patientId ya garantiza el tenant (el paciente se validó antes), pero el
  // filtro por tenantId queda como defensa en profundidad.
  const found = await prisma.clinicalEpisode.count({
    where: { id: { in: uniqueIds }, patientId, tenantId: ctx.tenantId },
  });
  return found === uniqueIds.length;
}

// GET /api/patients/:patientId/sessions
// Acepta ?episodeId= para filtrar por episodio (sesiones que abordaron ese motivo).
router.get<ParentParams>('/', async (req, res) => {
  const patient = await getPatient(req.context, req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;

  const sessions = await prisma.session.findMany({
    where: {
      patientId: req.params.patientId,
      tenantId: req.context.tenantId,
      ...(episodeId ? { episodes: { some: { episodeId } } } : {}),
    },
    orderBy: { sessionDate: 'desc' },
    select: sessionSelect,
  });

  res.json({ data: sessions.map(toSessionDTO) });
});

// GET /api/patients/:patientId/sessions/:sessionId
router.get<SessionParams>('/:sessionId', async (req, res) => {
  const patient = await getPatient(req.context, req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const session = await prisma.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
      tenantId: req.context.tenantId,
    },
    select: sessionSelect,
  });

  if (!session) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  res.json({ data: toSessionDTO(session) });
});

// POST /api/patients/:patientId/sessions
router.post<ParentParams>('/', async (req, res) => {
  const patient = await getPatient(req.context, req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  // La sesión queda atribuida al usuario autenticado que la registra.
  const { userId } = req.context;
  const { episodeIds, ...rest } = SessionCreateSchema.parse(req.body);

  if (!(await episodesBelongToPatient(req.context, req.params.patientId, episodeIds))) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  const session = await prisma.session.create({
    data: {
      ...rest,
      sessionDate: new Date(rest.sessionDate),
      patientId: req.params.patientId,
      tenantId: req.context.tenantId,
      userId,
      episodes: { create: episodeIds.map((episodeId) => ({ episode: { connect: { id: episodeId } } })) },
    },
    select: sessionSelect,
  });

  // Cierre automático del/los episodio(s) al registrar alta
  if (rest.sessionType === 'DISCHARGE' && episodeIds.length > 0) {
    prisma.clinicalEpisode
      .updateMany({
        where: { id: { in: episodeIds }, tenantId: req.context.tenantId },
        data: { status: 'DISCHARGED', closedAt: new Date() },
      })
      .catch((err) => console.error('[episode-close]', err));
  }

  const sessionTypeDesc: Record<string, string> = {
    SESSION: 'Sesión RPG registrada',
    NOTE: 'Nota clínica registrada',
    DISCHARGE: 'Alta registrada',
  };
  const painSuffix =
    rest.painScaleBefore != null && rest.painScaleAfter != null
      ? ` — Dolor ${rest.painScaleBefore} → ${rest.painScaleAfter}`
      : '';
  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      userId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'CREATED',
      description: `${sessionTypeDesc[rest.sessionType ?? 'SESSION'] ?? 'Sesión registrada'}${painSuffix}`,
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data: toSessionDTO(session) });
});

// PATCH /api/patients/:patientId/sessions/:sessionId
router.patch<SessionParams>('/:sessionId', async (req, res) => {
  const patient = await getPatient(req.context, req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const existing = await prisma.session.findFirst({
    where: {
      id: req.params.sessionId,
      patientId: req.params.patientId,
      tenantId: req.context.tenantId,
    },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Sesión no encontrada' });
    return;
  }

  const { episodeIds, ...rest } = SessionUpdateSchema.parse(req.body);

  if (episodeIds && !(await episodesBelongToPatient(req.context, req.params.patientId, episodeIds))) {
    res.status(400).json({ error: 'Episodio inexistente o de otro paciente' });
    return;
  }

  const session = await prisma.session.update({
    where: { id: req.params.sessionId },
    data: {
      ...rest,
      ...(rest.sessionDate ? { sessionDate: new Date(rest.sessionDate) } : {}),
      // Reemplaza el conjunto de episodios vinculados solo si se envía episodeIds.
      ...(episodeIds
        ? {
            episodes: {
              deleteMany: {},
              create: episodeIds.map((episodeId) => ({ episode: { connect: { id: episodeId } } })),
            },
          }
        : {}),
    },
    select: sessionSelect,
  });

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'SESSION',
      entityId: session.id,
      action: 'UPDATED',
      description: 'Sesión actualizada',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data: toSessionDTO(session) });
});

export default router;
