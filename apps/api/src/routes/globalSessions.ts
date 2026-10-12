import { Router } from 'express';
import { sessionRepo } from '../repositories';

const router = Router();

// GET /api/sessions — an index of every session of the clinic: who and when,
// nothing clinical (#186, SPEC-list-minimization.md §1). The session itself is
// read from GET /api/patients/:patientId/sessions/:sessionId.
router.get('/', async (req, res) => {
  const data = await sessionRepo.listIndexForTenant(req.context);
  res.json({ data });
});

export default router;
