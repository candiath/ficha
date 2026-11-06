// After each test, every session of the test's clinics has a revision, and its
// current rows equal its latest snapshot (SPEC-clinical-revisions.md §9): a
// repository write that skips recordRevision fails the test that exercises it.
//
// tests/setup.ts calls this from an afterEach. Vitest runs after-hooks in reverse
// order of definition, so that one runs after the file's own, and well before any
// afterAll that deletes the clinic. The imports are dynamic because setup.ts runs
// before anything may load Prisma, and a file with no clinic needs neither.
const clinics = new Set<string>();

export function watchClinic(tenantId: string): void {
  clinics.add(tenantId);
}

export function unwatchClinic(tenantId: string): void {
  clinics.delete(tenantId);
}

export async function assertRevisionInvariant(): Promise<void> {
  if (clinics.size === 0) return;
  const { prisma } = await import('../src/lib/prisma');
  const { sessionSnapshot } = await import('../src/repositories/prisma/sessionSnapshot');
  const { isDeepStrictEqual } = await import('node:util');

  const sessions = await prisma.session.findMany({
    where: { tenantId: { in: [...clinics] } },
    select: {
      id: true,
      userId: true,
      sessionType: true,
      sessionDate: true,
      observations: true,
      episodes: { orderBy: { episodeId: 'asc' } },
      revisions: { select: { snapshot: true }, orderBy: { version: 'desc' }, take: 1 },
    },
  });

  const unversioned = sessions.filter((s) => s.revisions.length === 0).map((s) => s.id);
  const drifted = sessions
    .filter((s) => s.revisions.length > 0 && !isDeepStrictEqual(sessionSnapshot(s), s.revisions[0].snapshot))
    .map((s) => s.id);
  if (unversioned.length > 0 || drifted.length > 0) {
    throw new Error(
      `Revision invariant broken. Sessions with no revision: [${unversioned.join(', ')}]; ` +
        `differing from their latest snapshot: [${drifted.join(', ')}]. ` +
        'A repository write skipped recordRevision, or a fixture skipped createSessionFixture.',
    );
  }
}
