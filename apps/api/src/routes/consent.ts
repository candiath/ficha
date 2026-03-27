import { Router } from 'express';
import { DEV_CONTEXT } from '../context/dev';
import { consentRepo } from '../repositories';
import { auditLogRepo } from '../repositories';

type Params = { patientId: string };

// Montado en /api/patients/:patientId/consent
const router = Router({ mergeParams: true });

// GET — get consent status
router.get<Params>('/', async (req, res) => {
  const data = await consentRepo.getByPatient(DEV_CONTEXT, req.params.patientId);
  res.json({ data });
});

// POST — sign consent
router.post<Params>('/', async (req, res) => {
  const data = await consentRepo.sign(DEV_CONTEXT, req.params.patientId);

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: req.params.patientId,
      entity: 'CONSENT',
      entityId: data.id,
      action: 'CREATED',
      description: 'Consentimiento informado firmado',
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data });
});

// DELETE — revoke consent
router.delete<Params>('/', async (req, res) => {
  const data = await consentRepo.revoke(DEV_CONTEXT, req.params.patientId);

  auditLogRepo
    .create(DEV_CONTEXT, {
      patientId: req.params.patientId,
      entity: 'CONSENT',
      entityId: data.id,
      action: 'UPDATED',
      description: 'Consentimiento informado revocado',
    })
    .catch((err) => console.error('[audit]', err));

  res.json({ data });
});

export default router;
