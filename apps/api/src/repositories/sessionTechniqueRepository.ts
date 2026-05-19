import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface BodyRegionDTO {
  id: string;
  name: string;
  zone: string | null;
}

export interface MuscularChainDTO {
  id: string;
  name: string;
  description: string | null;
}

export interface SessionTechniqueDTO {
  id: string;
  sessionId: string;
  techniqueId: string;
  techniqueName: string;
  bodyRegionId: string | null;
  bodyRegionName: string | null;
  muscularChainId: string | null;
  muscularChainName: string | null;
  variantNotes: string | null;
  createdAt: string;
}

export interface SessionTechniqueCreateDTO {
  techniqueId: string;
  bodyRegionId?: string | null;
  muscularChainId?: string | null;
  variantNotes?: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface SessionTechniqueRepository {
  listBodyRegions(): Promise<BodyRegionDTO[]>;
  listMuscularChains(): Promise<MuscularChainDTO[]>;

  listBySession(
    ctx: TenantContext,
    patientId: string,
    sessionId: string,
  ): Promise<SessionTechniqueDTO[]>;

  bulkReplace(
    ctx: TenantContext,
    patientId: string,
    sessionId: string,
    entries: SessionTechniqueCreateDTO[],
  ): Promise<SessionTechniqueDTO[]>;
}
