import { Router } from 'express';
import { encounterRepo } from '../repositories';

const router = Router();

// GET /api/encounters — an index of every encounter of the clinic: who and when,
// nothing clinical (#186, SPEC-list-minimization.md §1). The encounter itself is
// read from GET /api/patients/:patientId/encounters/:encounterId.
router.get('/', async (req, res) => {
  const data = await encounterRepo.listIndexForTenant(req.context);
  res.json({ data });
});

export default router;
