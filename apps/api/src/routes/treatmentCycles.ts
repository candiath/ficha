import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { treatmentCycleRepo } from '../repositories';

type Params = { patientId: string; cycleId: string };

// Montado en /api/patients/:patientId/cycles
const router = Router({ mergeParams: true });

const CycleCreateSchema = z.object({
  name: z.string().min(1),
  mainChainId: z.string().uuid().optional().nullable(),
  objective: z.string().optional().nullable(),
  targetSessions: z.number().int().positive().optional().nullable(),
  reevalEvery: z.number().int().positive().optional().nullable(),
  dischargeCriteria: z.string().optional().nullable(),
  startedAt: z.string().datetime({ offset: true }).optional(),
});

const CycleUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  mainChainId: z.string().uuid().optional().nullable(),
  objective: z.string().optional().nullable(),
  targetSessions: z.number().int().positive().optional().nullable(),
  reevalEvery: z.number().int().positive().optional().nullable(),
  dischargeCriteria: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'PAUSED']).optional(),
  completedAt: z.string().datetime({ offset: true }).optional().nullable(),
});

// GET /api/patients/:patientId/cycles
router.get<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const data = await treatmentCycleRepo.list(DEV_CONTEXT, req.params.patientId);
  res.json({ data });
});

// POST /api/patients/:patientId/cycles
router.post<Pick<Params, 'patientId'>>('/', async (req, res) => {
  const body = CycleCreateSchema.parse(req.body);
  const data = await treatmentCycleRepo.create(DEV_CONTEXT, req.params.patientId, body);
  res.status(201).json({ data });
});

// PATCH /api/patients/:patientId/cycles/:cycleId
router.patch<Params>('/:cycleId', async (req, res) => {
  const body = CycleUpdateSchema.parse(req.body);
  const data = await treatmentCycleRepo.update(
    DEV_CONTEXT,
    req.params.patientId,
    req.params.cycleId,
    body,
  );
  if (!data) {
    res.status(404).json({ error: 'Ciclo no encontrado' });
    return;
  }
  res.json({ data });
});

// DELETE /api/patients/:patientId/cycles/:cycleId
router.delete<Params>('/:cycleId', async (req, res) => {
  const deleted = await treatmentCycleRepo.delete(
    DEV_CONTEXT,
    req.params.patientId,
    req.params.cycleId,
  );
  if (!deleted) {
    res.status(404).json({ error: 'Ciclo no encontrado' });
    return;
  }
  res.status(204).send();
});

export default router;
