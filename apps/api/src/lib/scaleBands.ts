import type { ScaleType } from '@prisma/client';

// The disability band of a functional scale's score: a code, never a sentence.
// The screen words it (apps/web/src/lib/labels.ts). It is derived from the
// score each time it is read and not stored: the thresholds are the published
// ones of each scale, and a stored copy could only disagree with the score.
//
// The same word can mean a different range on each scale: MODERATE is 21–40 %
// on the Oswestry and 15–24 % on the NDI.
export type ScaleBand =
  | 'NONE'
  | 'MINIMAL'
  | 'MILD'
  | 'MODERATE'
  | 'SEVERE'
  | 'VERY_SEVERE'
  | 'MAXIMUM'
  | 'COMPLETE';

/** Oswestry Disability Index (Fairbank): 0–20, 21–40, 41–60, 61–80, 81–100 %. */
function oswestryBand(score: number): ScaleBand {
  if (score <= 20) return 'MINIMAL';
  if (score <= 40) return 'MODERATE';
  if (score <= 60) return 'SEVERE';
  if (score <= 80) return 'VERY_SEVERE';
  return 'MAXIMUM';
}

/** Neck Disability Index (Vernon): 0–4, 5–14, 15–24, 25–34, ≥35 %. */
function ndiBand(score: number): ScaleBand {
  if (score <= 4) return 'NONE';
  if (score <= 14) return 'MILD';
  if (score <= 24) return 'MODERATE';
  if (score <= 34) return 'SEVERE';
  return 'COMPLETE';
}

export function scaleBand(scaleType: ScaleType, score: number): ScaleBand {
  return scaleType === 'OSWESTRY' ? oswestryBand(score) : ndiBand(score);
}
