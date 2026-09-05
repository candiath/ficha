import { Router } from 'express';
import { z } from 'zod';
import { episodeRepo, patientRepo } from '../repositories';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes
const router = Router({ mergeParams: true });

const EpisodeCreateSchema = z.object({
  mainComplaint: z.string().optional().nullable(),
  openedAt: z.string().datetime({ offset: true }).optional(),
});

const EpisodeUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'DISCHARGED', 'ABANDONED']).optional(),
  mainComplaint: z.string().optional().nullable(),
  closedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// GET /api/patients/:patientId/episodes
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodes = await episodeRepo.listByPatient(req.context, req.params.patientId);

  // La alerta de inactividad se calculaba acá, y por eso el paciente que
  // nadie miraba nunca generaba una. Ahora vive en lib/alertRules.ts, que
  // recorre toda la clínica cuando se leen las alertas.
  res.json({ data: episodes });
});

// POST /api/patients/:patientId/episodes
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EpisodeCreateSchema.parse(req.body);

  const episode = await episodeRepo.create(req.context, req.params.patientId, {
    mainComplaint: body.mainComplaint,
    ...(body.openedAt ? { openedAt: new Date(body.openedAt) } : {}),
  });

  res.status(201).json({ data: episode });
});

// PATCH /api/patients/:patientId/episodes/:episodeId
router.patch<Params>('/:episodeId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EpisodeUpdateSchema.parse(req.body);

  // null = episodio inexistente o de otro paciente: mismo 404, sin revelar cuál.
  const episode = await episodeRepo.update(
    req.context,
    req.params.patientId,
    req.params.episodeId,
    {
      status: body.status,
      mainComplaint: body.mainComplaint,
      closedAt:
        body.closedAt !== undefined
          ? body.closedAt
            ? new Date(body.closedAt)
            : null
          : undefined,
    },
  );

  if (!episode) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  res.json({ data: episode });
});

export default router;
