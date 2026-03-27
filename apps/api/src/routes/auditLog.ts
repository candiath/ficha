import { Router } from 'express';
import { DEV_CONTEXT } from '../context/dev';
import { auditLogRepo } from '../repositories';

type Params = { patientId: string };

// Montado en /api/patients/:patientId/audit-log
const router = Router({ mergeParams: true });

// GET — list audit entries for a patient
router.get<Params>('/', async (req, res) => {
  const data = await auditLogRepo.listByPatient(DEV_CONTEXT, req.params.patientId);
  res.json({ data });
});

export default router;
