import type { RequestHandler } from 'express';
import { patientRepo } from '../repositories';

// Every route of a patient's record (/api/patients/:patientId/…) answers 404
// unless the patient is the clinic's and not deleted (CLAUDE.md, "Borrado de
// pacientes"). Decided once here, on the mount in app.ts, instead of in each
// handler, so a new record route cannot forget it.
// tests/livePatientCoverage.test.ts calls every such route on a deleted
// patient.
//
// The audit log is mounted without it on purpose: a deleted patient's history
// stays readable.
export const requireLivePatient: RequestHandler<{ patientId: string }> = async (req, res, next) => {
  if (!(await patientRepo.exists(req.context, req.params.patientId))) {
    res.status(404).json({ error: 'Paciente no encontrado' });
    return;
  }
  next();
};
