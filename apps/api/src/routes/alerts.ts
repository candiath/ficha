import { Router } from 'express';
import { z } from 'zod';
import { IdSchema } from '../lib/validation';
import { refreshAlerts } from '../lib/alertRules';
import { clinicalAlertRepo, patientRepo } from '../repositories';

const router = Router();

const AlertCreateSchema = z.object({
  patientId: IdSchema,
  type: z.enum(['FOLLOW_UP', 'NO_SHOW', 'PAYMENT', 'CUSTOM']),
  message: z.string().min(1),
});

// GET /api/alerts — list alerts with optional filters
//
// Antes de listar, el motor recalcula: sin cron, leer es el único momento en
// que se puede saber que hace tres semanas que un paciente no viene. Está
// throttled por tenant, así que casi siempre es una query de más y nada más.
router.get('/', async (req, res) => {
  await refreshAlerts(req.context);

  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const isRead =
    req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined;

  const data = await clinicalAlertRepo.list(req.context, { type, isRead });
  res.json({ data });
});

// GET /api/alerts/stats — unread counts by type
//
// El badge del layout pega acá en cada carga de página, así que también
// dispara el motor: si solo lo hiciera la lista, el contador que te dice que
// vayas a mirar nunca se enteraría de nada nuevo. El throttle es lo que hace
// que eso no sea caro.
router.get('/stats', async (req, res) => {
  await refreshAlerts(req.context);

  const data = await clinicalAlertRepo.stats(req.context);
  res.json({ data });
});

// POST /api/alerts — create new alert
router.post('/', async (req, res) => {
  const body = AlertCreateSchema.parse(req.body);

  // El patientId viaja en el body: sin este chequeo la alerta podía apuntar a
  // un paciente de otra clínica y el join de alertSelect exponía su fullName
  // (misma clase de fuga que tuvo POST /api/payments). La política completa
  // (del tenant Y vigente) vive en patientRepo: el findFirst propio que había
  // acá no filtraba borrados y dejaba crear alertas sobre pacientes eliminados.
  if (!(await patientRepo.exists(req.context, body.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const data = await clinicalAlertRepo.create(req.context, body);
  res.status(201).json({ data });
});

// PATCH /api/alerts/:id/read — mark single alert as read
router.patch('/:id/read', async (req, res) => {
  const data = await clinicalAlertRepo.markAsRead(req.context, req.params.id);

  // null = alerta inexistente o de otro tenant: mismo 404, sin revelar cuál.
  if (!data) {
    res.status(404).json({ error: 'Alerta no encontrada' });
    return;
  }

  res.json({ data });
});

// PATCH /api/alerts/read-all — mark all unread as read
router.patch('/read-all', async (req, res) => {
  const count = await clinicalAlertRepo.markAllAsRead(req.context);
  res.json({ data: { updated: count } });
});

export default router;
