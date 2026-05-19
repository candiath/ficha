import { Router } from 'express';
import { sessionTechniqueRepo } from '../repositories';

const router = Router();

// GET /api/muscular-chains
router.get('/', async (_req, res) => {
  const data = await sessionTechniqueRepo.listMuscularChains();
  res.json({ data });
});

export default router;
