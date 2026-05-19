import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export type CycleStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';

export interface TreatmentCycleDTO {
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

export interface TreatmentCycleCreateDTO {
  name: string;
  mainChainId?: string | null;
  objective?: string | null;
  targetSessions?: number | null;
  reevalEvery?: number | null;
  dischargeCriteria?: string | null;
  startedAt?: string;
}

export interface TreatmentCycleUpdateDTO {
  name?: string;
  mainChainId?: string | null;
  objective?: string | null;
  targetSessions?: number | null;
  reevalEvery?: number | null;
  dischargeCriteria?: string | null;
  status?: CycleStatus;
  completedAt?: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface TreatmentCycleRepository {
  list(ctx: TenantContext, patientId: string): Promise<TreatmentCycleDTO[]>;
  create(ctx: TenantContext, patientId: string, data: TreatmentCycleCreateDTO): Promise<TreatmentCycleDTO>;
  update(ctx: TenantContext, patientId: string, cycleId: string, data: TreatmentCycleUpdateDTO): Promise<TreatmentCycleDTO | null>;
  delete(ctx: TenantContext, patientId: string, cycleId: string): Promise<boolean>;
}
