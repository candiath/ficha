import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { prisma } from '../lib/prisma';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes
const router = Router({ mergeParams: true });

const episodeSelect = {
  id: true,
  patientId: true,
  status: true,
  mainComplaint: true,
  openedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const EpisodeCreateSchema = z.object({
  mainComplaint: z.string().optional().nullable(),
  openedAt: z.string().datetime({ offset: true }).optional(),
});

const EpisodeUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'DISCHARGED', 'ABANDONED']).optional(),
  mainComplaint: z.string().optional().nullable(),
  closedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

async function getPatient(patientId: string) {
  return prisma.patient.findFirst({
    where: { id: patientId, tenantId: DEV_CONTEXT.tenantId },
    select: { id: true },
  });
}

// GET /api/patients/:patientId/episodes
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodes = await prisma.clinicalEpisode.findMany({
    where: { patientId: req.params.patientId, tenantId: DEV_CONTEXT.tenantId },
    orderBy: { openedAt: 'desc' },
    select: episodeSelect,
  });

  res.json({ data: episodes });
});

// POST /api/patients/:patientId/episodes
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EpisodeCreateSchema.parse(req.body);

  const episode = await prisma.clinicalEpisode.create({
    data: {
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
      mainComplaint: body.mainComplaint,
      ...(body.openedAt ? { openedAt: new Date(body.openedAt) } : {}),
    },
    select: episodeSelect,
  });

  res.status(201).json({ data: episode });
});

// PATCH /api/patients/:patientId/episodes/:episodeId
router.patch<Params>('/:episodeId', async (req, res) => {
  const patient = await getPatient(req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const existing = await prisma.clinicalEpisode.findFirst({
    where: {
      id: req.params.episodeId,
      patientId: req.params.patientId,
      tenantId: DEV_CONTEXT.tenantId,
    },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const body = EpisodeUpdateSchema.parse(req.body);
  const episode = await prisma.clinicalEpisode.update({
    where: { id: req.params.episodeId },
    data: {
      ...body,
      ...(body.closedAt !== undefined
        ? { closedAt: body.closedAt ? new Date(body.closedAt) : null }
        : {}),
    },
    select: episodeSelect,
  });

  res.json({ data: episode });
});

export default router;
