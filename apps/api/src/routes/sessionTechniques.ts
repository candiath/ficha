import { Router } from 'express';
import { z } from 'zod';
import { DEV_CONTEXT } from '../context/dev';
import { sessionTechniqueRepo } from '../repositories';

type Params = { patientId: string; sessionId: string };

// Montado en /api/patients/:patientId/sessions/:sessionId/techniques
const router = Router({ mergeParams: true });

const BulkReplaceSchema = z.object({
  entries: z.array(
    z.object({
      techniqueId: z.string().uuid(),
      bodyRegionId: z.string().uuid().optional().nullable(),
      muscularChainId: z.string().uuid().optional().nullable(),
      variantNotes: z.string().optional().nullable(),
    }),
  ),
});

// GET — list techniques for a session
router.get<Params>('/', async (req, res) => {
  const data = await sessionTechniqueRepo.listBySession(
    DEV_CONTEXT,
    req.params.patientId,
    req.params.sessionId,
  );
  res.json({ data });
});

// PUT — replace all techniques for a session
router.put<Params>('/', async (req, res) => {
  const { entries } = BulkReplaceSchema.parse(req.body);
  const data = await sessionTechniqueRepo.bulkReplace(
    DEV_CONTEXT,
    req.params.patientId,
    req.params.sessionId,
    entries,
  );
  res.json({ data });
});

export default router;
