import type { RevisionMeta } from './patient';

export type EpisodeStatus = 'ACTIVE' | 'DISCHARGED' | 'ABANDONED';

export interface ClinicalEpisode {
  id: string;
  patientId: string;
  status: EpisodeStatus;
  mainComplaint: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // The latest version (0: none yet).
  version: number;
}

export interface EpisodeCreateData {
  mainComplaint?: string | null;
  openedAt?: string;
}

// A correction carries a reason; closing and reopening do not.
export interface EpisodeUpdateData extends RevisionMeta {
  status?: EpisodeStatus;
  mainComplaint?: string | null;
  closedAt?: string | null;
}
