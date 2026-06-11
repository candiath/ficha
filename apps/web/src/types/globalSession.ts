import type { Session } from './session';

// El endpoint global devuelve la sesión completa más el paciente y los episodios
// embebidos. Al extender Session (sin Omit), un GlobalSession es asignable a
// Session, por lo que puede pasarse directo a componentes que esperan Session
// sin necesidad de casts inseguros (`as never`).
export interface GlobalSession extends Session {
  patient: { id: string; fullName: string };
  episodes: { id: string; mainComplaint: string | null }[];
}
