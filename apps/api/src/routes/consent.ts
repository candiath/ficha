import { Router } from 'express';
import { consentRepo, patientRepo } from '../repositories';
import { auditLogRepo } from '../repositories';

type Params = { patientId: string };

// Montado en /api/patients/:patientId/consent
//
// Igual que episodios, sesiones, escalas, alertas y paquetes, cada handler
// exige primero que el paciente sea del tenant Y esté vigente (patientRepo
// aplica esa política). Sin ese chequeo, el patientId de la URL entraba
// directo a la query: firmar contra un paciente inexistente violaba la FK
// (P2003 → 500 en vez de 404), se podía firmar el consentimiento de un
// paciente borrado, y como patientId es @unique global en InformedConsent,
// una firma contra el paciente de otra clínica dejaba una fila con nuestro
// tenantId que le impedía firmar al dueño real para siempre.
const router = Router({ mergeParams: true });

// GET — estado del consentimiento
router.get<Params>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const data = await consentRepo.getByPatient(req.context, req.params.patientId);
  res.json({ data });
});

// POST — firmar el consentimiento
router.post<Params>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  const data = await consentRepo.sign(req.context, req.params.patientId);

  auditLogRepo
    .create(req.context, {
      patientId: req.params.patientId,
      entity: 'CONSENT',
      entityId: data.id,
      action: 'CREATED',
      description: 'Consentimiento informado firmado',
    })
    .catch((err) => console.error('[audit]', err));

  res.status(201).json({ data });
});

// DELETE — revocar el consentimiento
router.delete<Params>('/', async (req, res) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }

  // null = el paciente existe pero nunca firmó: no hay nada que revocar.
  // Antes el update sin fila tiraba P2025 y el error handler lo convertía
  // en un 500.
  const data = await consentRepo.revoke(req.context, req.params.patientId);

  if (!data) {
    res.status(404).json({ error: 'Consentimiento no encontrado' });
    return;
  }

  auditLogRepo
    .create(req.context, {
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
