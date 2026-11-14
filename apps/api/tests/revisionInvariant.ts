// After each test, every clinical aggregate of the test's clinics has a
// revision, and its current rows equal its latest snapshot
// (SPEC-clinical-revisions.md §9): a repository write that skips recordRevision
// fails the test that exercises it. The six aggregates: sessions (with their
// blocks), patients, episodes, initial evaluations, informed consents and
// patient events.
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

interface Checked {
  id: string;
  revisions: { snapshot: unknown }[];
}

export async function assertRevisionInvariant(): Promise<void> {
  if (clinics.size === 0) return;
  const { prisma } = await import('../src/lib/prisma');
  const { sessionSnapshot } = await import('../src/repositories/prisma/sessionSnapshot');
  const snapshots = await import('../src/repositories/prisma/clinicalSnapshots');
  const { isDeepStrictEqual } = await import('node:util');

  const where = { tenantId: { in: [...clinics] } };
  const latest = { select: { snapshot: true }, orderBy: { version: 'desc' }, take: 1 } as const;

  const [sessions, patients, episodes, evaluations, consents, events] = await Promise.all([
    prisma.session.findMany({
      where,
      select: {
        id: true,
        userId: true,
        sessionType: true,
        sessionDate: true,
        observations: true,
        episodes: { orderBy: { episodeId: 'asc' } },
        revisions: latest,
      },
    }),
    prisma.patient.findMany({ where, include: { revisions: latest } }),
    prisma.clinicalEpisode.findMany({ where, include: { revisions: latest } }),
    prisma.initialEvaluation.findMany({ where, include: { revisions: latest } }),
    prisma.informedConsent.findMany({ where, include: { revisions: latest } }),
    prisma.patientEvent.findMany({ where, include: { revisions: latest } }),
  ]);

  const problems: string[] = [];
  function check<R extends Checked>(name: string, rows: R[], project: (row: R) => unknown): void {
    const unversioned = rows.filter((r) => r.revisions.length === 0).map((r) => r.id);
    const drifted = rows
      .filter((r) => r.revisions.length > 0 && !isDeepStrictEqual(project(r), r.revisions[0].snapshot))
      .map((r) => r.id);
    if (unversioned.length > 0) problems.push(`${name} with no revision: [${unversioned.join(', ')}]`);
    if (drifted.length > 0) problems.push(`${name} differing from their latest snapshot: [${drifted.join(', ')}]`);
  }
  check('sessions', sessions, sessionSnapshot);
  check('patients', patients, snapshots.patientSnapshot);
  check('episodes', episodes, snapshots.episodeSnapshot);
  check('evaluations', evaluations, snapshots.evaluationSnapshot);
  check('consents', consents, snapshots.consentSnapshot);
  check('patient events', events, snapshots.patientEventSnapshot);

  if (problems.length > 0) {
    throw new Error(
      `Revision invariant broken. ${problems.join('; ')}. ` +
        'A repository write skipped recordRevision, or a fixture skipped tests/fixtures.ts (createSessionFixture for sessions).',
    );
  }
}
