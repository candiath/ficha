import { Router } from 'express';
import { z } from 'zod';
import { clinicalDateField } from '../lib/clinicalDate';
import { OptionalTextSchema } from '../lib/validation';
import { episodeRepo, patientRepo } from '../repositories';
import type { AuditEntry } from '../repositories/auditLogRepository';
import type { EpisodeUpdateAudit } from '../repositories/episodeRepository';
import { idParam } from '../middlewares/idParam';

type Params = { patientId: string; episodeId: string };

// Montado en /api/patients/:patientId/episodes
const router = Router({ mergeParams: true });
router.param('episodeId', idParam('Episodio no encontrado'));

const CLOSING_STATUSES = ['DISCHARGED', 'ABANDONED'] as const;

function cierra(status: string | undefined): boolean {
  return (CLOSING_STATUSES as readonly string[]).includes(status ?? '');
}

const EpisodeCreateSchema = z.object({
  mainComplaint: OptionalTextSchema,
  openedAt: clinicalDateField('La fecha de apertura').optional(),
});

// El cierre viaja completo o no viaja: estado y fecha son un solo dato partido
// en dos columnas, y hasta ahora nada obligaba a que dijeran lo mismo. Se podía
// dar de alta un episodio sin fecha de alta, o reactivarlo dejándole la fecha
// de cierre vieja; el invariante lo sostenía sólo la web, que manda las dos
// cosas juntas. Acá queda del lado de la API, que es quien responde por el dato.
const EpisodeUpdateSchema = z
  .object({
    status: z.enum(['ACTIVE', 'DISCHARGED', 'ABANDONED']).optional(),
    mainComplaint: OptionalTextSchema,
    closedAt: clinicalDateField('La fecha de cierre').nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (cierra(data.status) && typeof data.closedAt !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['closedAt'],
        message: 'Cerrar un episodio necesita su fecha de cierre',
      });
    }

    if (typeof data.closedAt === 'string' && !cierra(data.status)) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'La fecha de cierre sólo viaja junto al estado que cierra el episodio',
      });
    }

    if (data.closedAt === null && data.status !== 'ACTIVE') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Borrar la fecha de cierre es reabrir el episodio: mandá también ACTIVE',
      });
    }
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

  const episode = await episodeRepo.create(
    req.context,
    req.params.patientId,
    {
      mainComplaint: body.mainComplaint,
      ...(body.openedAt ? { openedAt: new Date(body.openedAt) } : {}),
    },
    (e) => ({ action: 'EPISODE_OPENED', patientId: req.params.patientId, entityId: e.id, params: {} }),
  );

  res.status(201).json({ data: episode });
});

// The audit entry of what an update did (SPEC-clinical-revisions.md §4): a
// change of status is its own fact, with no reason; a correction names the
// fields it changed.
function episodeAudit(patientId: string): EpisodeUpdateAudit {
  return (episode, change): AuditEntry => {
    const base = { patientId, entityId: episode.id };
    switch (change.kind) {
      case 'closed':
        return { ...base, action: 'EPISODE_CLOSED', params: { status: change.status } };
      case 'reopened':
        return { ...base, action: 'EPISODE_REOPENED', params: {} };
      case 'corrected':
        return { ...base, action: 'EPISODE_UPDATED', params: { changedFields: change.changedFields } };
    }
  };
}

// PATCH /api/patients/:patientId/episodes/:episodeId
router.patch<Params>('/:episodeId', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const body = EpisodeUpdateSchema.parse(req.body);

  const result = await episodeRepo.update(
    req.context,
    req.params.patientId,
    req.params.episodeId,
    {
      status: body.status,
      mainComplaint: body.mainComplaint,
      // Reabrir borra la fecha de cierre aunque el body no la mande: un
      // episodio ACTIVE con fecha de cierre es el estado incoherente que el
      // schema ya no deja escribir a propósito.
      closedAt: body.status === 'ACTIVE' ? null : body.closedAt ? new Date(body.closedAt) : undefined,
    },
    episodeAudit(req.params.patientId),
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        // Inexistente o de otro paciente: mismo 404, sin revelar cuál.
        res.status(404).json({ error: 'Episodio no encontrado' });
        return;
      case 'closed_before_opened':
        res.status(400).json({
          error: 'La fecha de cierre no puede ser anterior a la apertura del episodio',
        });
        return;
      case 'transition_with_correction':
        res.status(400).json({
          error: 'Cerrar o reabrir el episodio y corregir su motivo de consulta se guardan por separado',
        });
        return;
    }
  }

  res.json({ data: result.episode });
});

export default router;
