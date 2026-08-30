import { Router } from 'express';
import { z } from 'zod';
import { clinicalAlertRepo, patientRepo } from '../repositories';
import type { TenantContext } from '../repositories/types';
import type { TenantScopedClient } from '../lib/tenantScope';

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

// Días sin sesiones antes de generar alerta de inactividad
const INACTIVE_DAYS = 21;
// Días de cooldown para no duplicar alertas del mismo tipo
const ALERT_COOLDOWN_DAYS = 7;

// Recibe ctx además de db: la creación de la alerta va por clinicalAlertRepo
// (que scopea con el ctx); los dos reads siguen en db hasta tener repo propio.
async function checkInactiveEpisode(
  ctx: TenantContext,
  db: TenantScopedClient,
  patientId: string,
  episodeId: string,
  mainComplaint: string | null,
) {
  const lastSession = await db.session.findFirst({
    where: { patientId, episodes: { some: { episodeId } } },
    orderBy: { sessionDate: 'desc' },
    select: { sessionDate: true },
  });

  const inactiveCutoff = new Date();
  inactiveCutoff.setDate(inactiveCutoff.getDate() - INACTIVE_DAYS);

  const isInactive = !lastSession || lastSession.sessionDate < inactiveCutoff;
  if (!isInactive) return;

  // No crear alerta si ya existe una no leída reciente
  const alertCutoff = new Date();
  alertCutoff.setDate(alertCutoff.getDate() - ALERT_COOLDOWN_DAYS);
  const existing = await db.clinicalAlert.findFirst({
    where: {
      patientId,
      type: 'NO_SHOW',
      isRead: false,
      createdAt: { gte: alertCutoff },
    },
    select: { id: true },
  });
  if (existing) return;

  const daysSince = lastSession
    ? Math.floor((Date.now() - lastSession.sessionDate.getTime()) / 86_400_000)
    : null;
  const episodeLabel = mainComplaint ? `"${mainComplaint}"` : 'el episodio activo';
  const message = daysSince
    ? `Sin sesiones en ${daysSince} días (episodio ${episodeLabel}). Considerá contactar al paciente o marcar el episodio como abandonado.`
    : `El paciente no tiene sesiones registradas en ${episodeLabel}. Considerá hacer un seguimiento.`;

  await clinicalAlertRepo.create(ctx, { patientId, type: 'NO_SHOW', message });
}

// GET /api/patients/:patientId/episodes
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodes = await req.db.clinicalEpisode.findMany({
    where: { patientId: req.params.patientId },
    orderBy: { openedAt: 'desc' },
    select: episodeSelect,
  });

  res.json({ data: episodes });

  // Verificación de inactividad fire-and-forget (no bloquea la respuesta)
  const activeEpisodes = episodes.filter((ep) => ep.status === 'ACTIVE');
  for (const ep of activeEpisodes) {
    checkInactiveEpisode(
      req.context,
      req.db,
      req.params.patientId,
      ep.id,
      ep.mainComplaint,
    ).catch((err) => console.error('[inactive-check]', err));
  }
});

// POST /api/patients/:patientId/episodes
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EpisodeCreateSchema.parse(req.body);

  const episode = await req.db.clinicalEpisode.create({
    data: {
      patientId: req.params.patientId,
      mainComplaint: body.mainComplaint,
      ...(body.openedAt ? { openedAt: new Date(body.openedAt) } : {}),
    },
    select: episodeSelect,
  });

  res.status(201).json({ data: episode });
});

// PATCH /api/patients/:patientId/episodes/:episodeId
router.patch<Params>('/:episodeId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const existing = await req.db.clinicalEpisode.findFirst({
    where: {
      id: req.params.episodeId,
      patientId: req.params.patientId,
    },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Episodio no encontrado' });
    return;
  }

  const body = EpisodeUpdateSchema.parse(req.body);
  const episode = await req.db.clinicalEpisode.update({
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
