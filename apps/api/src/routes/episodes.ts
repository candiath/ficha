import { Router } from 'express';
import { z } from 'zod';
import { clinicalAlertRepo, episodeRepo, patientRepo } from '../repositories';
import type { TenantContext } from '../repositories/types';

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

// Días sin sesiones antes de generar alerta de inactividad
const INACTIVE_DAYS = 21;
// Días de cooldown para no duplicar alertas del mismo tipo
const ALERT_COOLDOWN_DAYS = 7;

// FOLLOW_UP y no NO_SHOW: "hace 40 días que este paciente no viene" es
// seguimiento. Una inasistencia es faltar a un turno agendado, y hasta que
// exista el modelo de agenda eso no se puede saber — no hay con qué faltar.
// Tiparla acá dejaba el chip de la UI diciendo "Inasistencia" sobre un texto
// que habla de otra cosa, y ocupaba el único tipo que sí va a tener fuente
// real cuando lleguen los turnos.
const INACTIVITY_ALERT_TYPE = 'FOLLOW_UP' as const;

// La política (umbral de inactividad, cooldown, redacción del mensaje) vive
// acá — es dominio; el acceso a datos va por los repos.
async function checkInactiveEpisode(
  ctx: TenantContext,
  patientId: string,
  episodeId: string,
  mainComplaint: string | null,
) {
  const lastActivity = await episodeRepo.lastActivityAt(ctx, patientId, episodeId);

  // Un episodio sin ninguna sesión no es inactividad, es un episodio recién
  // abierto: al paciente se lo da de alta justo cuando viene a atenderse, así
  // que ese hueco siempre es de horas. Se alerta sólo cuando hubo actividad y
  // se cortó — sin sesión previa no hay nada de qué hacer seguimiento.
  if (!lastActivity) return;

  const inactiveCutoff = new Date();
  inactiveCutoff.setDate(inactiveCutoff.getDate() - INACTIVE_DAYS);

  if (lastActivity >= inactiveCutoff) return;

  // No crear alerta si ya existe una no leída reciente
  const alertCutoff = new Date();
  alertCutoff.setDate(alertCutoff.getDate() - ALERT_COOLDOWN_DAYS);
  if (
    await clinicalAlertRepo.hasRecentUnread(ctx, patientId, INACTIVITY_ALERT_TYPE, alertCutoff)
  ) {
    return;
  }

  const daysSince = Math.floor((Date.now() - lastActivity.getTime()) / 86_400_000);
  const episodeLabel = mainComplaint ? `"${mainComplaint}"` : 'el episodio activo';
  const message = `Sin sesiones en ${daysSince} días (episodio ${episodeLabel}). Considerá contactar al paciente o marcar el episodio como abandonado.`;

  await clinicalAlertRepo.create(ctx, { patientId, type: INACTIVITY_ALERT_TYPE, message });
}

// GET /api/patients/:patientId/episodes
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const episodes = await episodeRepo.listByPatient(req.context, req.params.patientId);

  res.json({ data: episodes });

  // Verificación de inactividad fire-and-forget (no bloquea la respuesta)
  const activeEpisodes = episodes.filter((ep) => ep.status === 'ACTIVE');
  for (const ep of activeEpisodes) {
    checkInactiveEpisode(
      req.context,
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
