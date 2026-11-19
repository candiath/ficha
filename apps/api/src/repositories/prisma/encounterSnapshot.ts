import type { EncounterType } from '@prisma/client';
import type { EncounterSnapshotV1 } from '@ficha/shared';

// The canonical projection of an encounter (SPEC-clinical-revisions.md §3): the one
// mapping from its rows to a snapshot. tests/historyProjectionCoverage.test.ts
// holds every other column of `encounters` and `encounter_blocks` to a decision.

interface EncounterState {
  userId: string;
  encounterType: EncounterType;
  encounterDate: Date;
  observations: string | null;
  // Ordered by episode: the select that reads them says so.
  episodes: EncounterSnapshotV1['episodes'];
}

export function encounterSnapshot(s: EncounterState): EncounterSnapshotV1 {
  return {
    userId: s.userId,
    encounterType: s.encounterType,
    encounterDate: s.encounterDate.toISOString(),
    observations: s.observations,
    episodes: s.episodes.map((b) => ({
      episodeId: b.episodeId,
      preEncounterState: b.preEncounterState,
      treatment: b.treatment,
      painScaleBefore: b.painScaleBefore,
      painScaleAfter: b.painScaleAfter,
      patientExercises: b.patientExercises,
      reEvaluationNotes: b.reEvaluationNotes,
    })),
  };
}
