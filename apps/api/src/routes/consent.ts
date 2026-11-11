import { Router } from 'express';
import { z } from 'zod';
import { ExpectedVersionSchema, STALE_EDIT } from '../lib/staleEdit';
import { consentRepo } from '../repositories';
import { revisionRoutes } from './revisions';

type Params = { patientId: string };

// Montado en /api/patients/:patientId/consent
//
// Like every record route, it runs only for a live patient of the clinic
// (requireLivePatient, mounted in app.ts). Without that check the URL's
// patientId went straight into the query: signing for a patient that does
// not exist broke the foreign key (a 500 instead of a 404), a deleted
// patient's consent could be signed, and since patientId is globally unique
// in InformedConsent, signing for another clinic's patient left a row with
// our tenantId that kept the real owner from ever signing.
const router = Router({ mergeParams: true });

// The version the screen showed (0: none), so signing over a consent someone
// else signed or revoked meanwhile is a 409. Revoking is a DELETE, which the
// web client sends with no body.
const SignSchema = z.strictObject({ expectedVersion: ExpectedVersionSchema });

// GET — estado del consentimiento
router.get<Params>('/', async (req, res) => {
  const data = await consentRepo.getByPatient(req.context, req.params.patientId);
  res.json({ data });
});

// POST — firmar el consentimiento
router.post<Params>('/', async (req, res) => {
  const { expectedVersion } = SignSchema.parse(req.body ?? {});
  const result = await consentRepo.sign(req.context, req.params.patientId, expectedVersion, (c) => ({
    action: 'CONSENT_SIGNED',
    patientId: req.params.patientId,
    entityId: c.id,
    params: {},
  }));

  if (!result.ok) {
    res.status(409).json(STALE_EDIT);
    return;
  }
  res.status(201).json({ data: result.consent });
});

// DELETE — revocar el consentimiento
router.delete<Params>('/', async (req, res) => {
  // null = el paciente existe pero nunca firmó: no hay nada que revocar.
  // Antes el update sin fila tiraba P2025 y el error handler lo convertía
  // en un 500.
  const data = await consentRepo.revoke(req.context, req.params.patientId, (c) => ({
    action: 'CONSENT_REVOKED',
    patientId: req.params.patientId,
    entityId: c.id,
    params: {},
  }));

  if (!data) {
    res.status(404).json({ error: 'Consentimiento no encontrado' });
    return;
  }

  res.json({ data });
});

// Its history (SPEC-clinical-revisions.md §7).
router.use('/revisions', revisionRoutes(() => ({ aggregate: 'consent' }), 'Consentimiento no encontrado'));

export default router;
