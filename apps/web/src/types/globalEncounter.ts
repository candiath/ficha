import type { EncounterType } from './encounter';

// An entry of GET /api/encounters: who and when, nothing clinical (#186,
// SPEC-list-minimization.md §1). It does not extend Encounter on purpose, and
// nothing casts between them: an edit form fed a partial encounter saves every
// field it lacks as empty, which erases clinical text. The encounter itself is
// read with encounterApi.get.
export interface EncounterIndexItem {
  id: string;
  encounterType: EncounterType;
  encounterDate: string;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
}
