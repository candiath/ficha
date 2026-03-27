import { Router } from 'express';
import { sessionTechniqueRepo } from '../repositories';

const router = Router();

// GET /api/body-regions
router.get('/', async (_req, res) => {
  const data = await sessionTechniqueRepo.listBodyRegions();
  res.json({ data });
});

export default router;
