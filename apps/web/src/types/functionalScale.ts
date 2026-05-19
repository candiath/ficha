export type ScaleType = 'OSWESTRY' | 'NDI';

export interface FunctionalScale {
  id: string;
  scaleType: ScaleType;
  score: number;
  interpretation: string;
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
