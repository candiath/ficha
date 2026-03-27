import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { clinicalAlertRepo } from '../repositories';

const router = Router();

const AlertCreateSchema = z.object({
  patientId: z.string().uuid(),
  type: z.enum(['FOLLOW_UP', 'NO_SHOW', 'PAYMENT', 'CUSTOM']),
  message: z.string().min(1),
});

// GET /api/alerts — list alerts with optional filters
router.get('/', async (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const isRead =
    req.query.isRead === 'true' ? true : req.query.isRead === 'false' ? false : undefined;

  const data = await clinicalAlertRepo.list(DEV_CONTEXT, { type, isRead });
  res.json({ data });
});

// GET /api/alerts/stats — unread counts by type
router.get('/stats', async (_req, res) => {
  const data = await clinicalAlertRepo.stats(DEV_CONTEXT);
  res.json({ data });
});

// POST /api/alerts — create new alert
router.post('/', async (req, res) => {
  const body = AlertCreateSchema.parse(req.body);
  const data = await clinicalAlertRepo.create(DEV_CONTEXT, body);
  res.status(201).json({ data });
});

// PATCH /api/alerts/:id/read — mark single alert as read
router.patch('/:id/read', async (req, res) => {
  const data = await clinicalAlertRepo.markAsRead(DEV_CONTEXT, req.params.id);
  res.json({ data });
});

// PATCH /api/alerts/read-all — mark all unread as read
router.patch('/read-all', async (_req, res) => {
  const count = await clinicalAlertRepo.markAllAsRead(DEV_CONTEXT);
  res.json({ data: { updated: count } });
});

export default router;
