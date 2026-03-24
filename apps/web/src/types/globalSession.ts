import type { Session } from './session';

export interface GlobalSession extends Omit<Session, 'preSesionState' | 'reEvaluationNotes' | 'patientResponse' | 'updatedAt'> {
  patient: { id: string; fullName: string };
}
