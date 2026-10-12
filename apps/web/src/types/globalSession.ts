import type { SessionType } from './session';

// An entry of GET /api/sessions: who and when, nothing clinical (#186,
// SPEC-list-minimization.md §1). It does not extend Session on purpose, and
// nothing casts between them: an edit form fed a partial session saves every
// field it lacks as empty, which erases clinical text. The session itself is
// read with sessionApi.get.
export interface SessionIndexItem {
  id: string;
  sessionType: SessionType;
  sessionDate: string;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
}
