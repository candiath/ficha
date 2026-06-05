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
}

export interface EpisodeCreateData {
  mainComplaint?: string | null;
  openedAt?: string;
}

export interface EpisodeUpdateData {
  status?: EpisodeStatus;
  mainComplaint?: string | null;
  closedAt?: string | null;
}
