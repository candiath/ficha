export interface SessionTechnique {
  id: string;
  sessionId: string;
  techniqueId: string;
  techniqueName: string;
  bodyRegionId: string | null;
  bodyRegionName: string | null;
  variantNotes: string | null;
  createdAt: string;
}

export interface SessionTechniqueCreateEntry {
  techniqueId: string;
  bodyRegionId?: string | null;
  variantNotes?: string | null;
}
