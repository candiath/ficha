import { describe, expect, it } from 'vitest';
import { scaleBand } from '../src/lib/scaleBands';

// The published thresholds of each scale, at both edges of every band.
describe('a scale score reads as its band', () => {
  it('Oswestry: 0–20, 21–40, 41–60, 61–80, 81–100 %', () => {
    expect([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map((s) => scaleBand('OSWESTRY', s))).toEqual([
      'MINIMAL', 'MINIMAL', 'MODERATE', 'MODERATE', 'SEVERE', 'SEVERE', 'VERY_SEVERE', 'VERY_SEVERE', 'MAXIMUM', 'MAXIMUM',
    ]);
  });

  it('NDI: 0–4, 5–14, 15–24, 25–34, ≥35 %', () => {
    expect([0, 4, 5, 14, 15, 24, 25, 34, 35, 100].map((s) => scaleBand('NDI', s))).toEqual([
      'NONE', 'NONE', 'MILD', 'MILD', 'MODERATE', 'MODERATE', 'SEVERE', 'SEVERE', 'COMPLETE', 'COMPLETE',
    ]);
  });
});
