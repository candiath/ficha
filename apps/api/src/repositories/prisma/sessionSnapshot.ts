import type { Prisma, SessionType } from '@prisma/client';
import { SESSION_SNAPSHOT_VERSION, SessionSnapshotV1 } from '@ficha/shared';
import { RevisionError } from './recordRevision';

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

// The latest version of a session, or null if it has none (version 0: written
// before revisions existed). The caller holds the session's lock.
export async function latestSessionRevision(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sessionId: string,
): Promise<{ version: number; snapshot: SessionSnapshotV1 } | null> {
  const revision = await tx.sessionRevision.findFirst({
    where: { tenantId, sessionId },
    orderBy: { version: 'desc' },
    select: { version: true, schemaVersion: true, snapshot: true },
  });
  if (!revision) return null;

  const parsed = SessionSnapshotV1.safeParse(revision.snapshot);
  if (revision.schemaVersion !== SESSION_SNAPSHOT_VERSION || !parsed.success) {
    throw new RevisionError(
      `revision unreadable: schema=${revision.schemaVersion} table=session_revisions id=${sessionId}`,
    );
  }
  return { version: revision.version, snapshot: parsed.data };
}
