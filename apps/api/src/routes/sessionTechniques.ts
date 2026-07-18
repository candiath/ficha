import { Router } from 'express';
import { z } from 'zod';
import { techniquesBelongToTenant } from '../lib/techniques';
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
    req.context,
    req.params.patientId,
    req.params.sessionId,
  );
  res.json({ data });
});

// PUT — replace all techniques for a session
router.put<Params>('/', async (req, res) => {
  const { entries } = BulkReplaceSchema.parse(req.body);

  // Mismo criterio que el POST de sesiones: las técnicas deben ser del
  // tenant o globales; Zod solo valida el formato del uuid.
  if (!(await techniquesBelongToTenant(req.context, entries.map((e) => e.techniqueId)))) {
    res.status(400).json({ error: 'Técnica inexistente' });
    return;
  }

  const data = await sessionTechniqueRepo.bulkReplace(
    req.context,
    req.params.patientId,
    req.params.sessionId,
    entries,
  );
  res.json({ data });
});

export default router;
