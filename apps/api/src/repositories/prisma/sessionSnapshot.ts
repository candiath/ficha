import type { SessionType } from '@prisma/client';
import type { SessionSnapshotV1 } from '@ficha/shared';

// The canonical projection of a session (SPEC-clinical-revisions.md §3): the one
// mapping from its rows to a snapshot. tests/historyProjectionCoverage.test.ts
// holds every other column of `sessions` and `session_episodes` to a decision.

interface SessionState {
  userId: string;
  sessionType: SessionType;
  sessionDate: Date;
  observations: string | null;
  // Ordered by episode: the select that reads them says so.
  episodes: SessionSnapshotV1['episodes'];
}

export function sessionSnapshot(s: SessionState): SessionSnapshotV1 {
  return {
    userId: s.userId,
    sessionType: s.sessionType,
    sessionDate: s.sessionDate.toISOString(),
    observations: s.observations,
    episodes: s.episodes.map((b) => ({
      episodeId: b.episodeId,
      preSessionState: b.preSessionState,
      treatment: b.treatment,
      painScaleBefore: b.painScaleBefore,
      painScaleAfter: b.painScaleAfter,
      patientExercises: b.patientExercises,
      reEvaluationNotes: b.reEvaluationNotes,
    })),
  };
}
