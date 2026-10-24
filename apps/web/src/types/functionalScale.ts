export type ScaleType = 'OSWESTRY' | 'NDI';

// The band of a score, as the API derives it (apps/api/src/lib/scaleBands.ts).
export type ScaleBand =
  | 'NONE'
  | 'MINIMAL'
  | 'MILD'
  | 'MODERATE'
  | 'SEVERE'
  | 'VERY_SEVERE'
  | 'MAXIMUM'
  | 'COMPLETE';

export interface FunctionalScale {
  id: string;
  scaleType: ScaleType;
  score: number;
  band: ScaleBand;
  appliedAt: string;
  createdAt: string;
}

export interface FunctionalScaleDetail extends FunctionalScale {
  responses: Record<string, number>;
}

export interface FunctionalScaleCreateData {
  scaleType: ScaleType;
  responses: Record<string, number>;
  appliedAt?: string;
}
