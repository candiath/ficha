export type CycleStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';

export interface TreatmentCycle {
  id: string;
  patientId: string;
  name: string;
  mainChainId: string | null;
  mainChainName: string | null;
  objective: string | null;
  targetSessions: number | null;
  reevalEvery: number | null;
  dischargeCriteria: string | null;
  status: CycleStatus;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentCycleCreateData {
  name: string;
  mainChainId?: string | null;
  objective?: string | null;
  targetSessions?: number | null;
  reevalEvery?: number | null;
  dischargeCriteria?: string | null;
  startedAt?: string;
}

export interface TreatmentCycleUpdateData {
  name?: string;
  mainChainId?: string | null;
  objective?: string | null;
  targetSessions?: number | null;
  reevalEvery?: number | null;
  dischargeCriteria?: string | null;
  status?: CycleStatus;
  completedAt?: string | null;
}
