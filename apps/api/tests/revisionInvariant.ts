// After each test, every clinical aggregate of the test's clinics has a
// revision, and its current rows equal its latest snapshot
// (SPEC-clinical-revisions.md §9): a repository write that skips recordRevision
// fails the test that exercises it. The six aggregates: encounters (with their
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
  revisions: { schemaVersion: number; snapshot: unknown }[];
}

export async function assertRevisionInvariant(): Promise<void> {
  if (clinics.size === 0) return;
  const { prisma } = await import('../src/lib/prisma');
  const { encounterSnapshot } = await import('../src/repositories/prisma/encounterSnapshot');
  const snapshots = await import('../src/repositories/prisma/clinicalSnapshots');
  const shared = await import('@ficha/shared');
  const { isDeepStrictEqual } = await import('node:util');

  const where = { tenantId: { in: [...clinics] } };
  const latest = { select: { schemaVersion: true, snapshot: true }, orderBy: { version: 'desc' }, take: 1 } as const;

  const [encounters, patients, episodes, evaluations, consents, events] = await Promise.all([
    prisma.encounter.findMany({
      where,
      select: {
        id: true,
        userId: true,
        encounterType: true,
        encounterDate: true,
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
  // The latest snapshot as it reads today: one written with an earlier schema
  // version is compared in the current shape, as the write path does
  // (packages/shared clinicalSnapshots.ts). One that does not read is drift.
  function check<R extends Checked>(
    name: string,
    rows: R[],
    project: (row: R) => unknown,
    history: { read(schemaVersion: number, snapshot: unknown): unknown },
  ): void {
    const unversioned = rows.filter((r) => r.revisions.length === 0).map((r) => r.id);
    const drifted = rows
      .filter(
        (r) =>
          r.revisions.length > 0 &&
          !isDeepStrictEqual(project(r), history.read(r.revisions[0].schemaVersion, r.revisions[0].snapshot)),
      )
      .map((r) => r.id);
    if (unversioned.length > 0) problems.push(`${name} with no revision: [${unversioned.join(', ')}]`);
    if (drifted.length > 0) problems.push(`${name} differing from their latest snapshot: [${drifted.join(', ')}]`);
  }
  check('encounters', encounters, encounterSnapshot, shared.ENCOUNTER_SNAPSHOTS);
  check('patients', patients, snapshots.patientSnapshot, shared.PATIENT_SNAPSHOTS);
  check('episodes', episodes, snapshots.episodeSnapshot, shared.EPISODE_SNAPSHOTS);
  check('evaluations', evaluations, snapshots.evaluationSnapshot, shared.EVALUATION_SNAPSHOTS);
  check('consents', consents, snapshots.consentSnapshot, shared.CONSENT_SNAPSHOTS);
  check('patient events', events, snapshots.patientEventSnapshot, shared.PATIENT_EVENT_SNAPSHOTS);

  if (problems.length > 0) {
    throw new Error(
      `Revision invariant broken. ${problems.join('; ')}. ` +
        'A repository write skipped recordRevision, or a fixture skipped tests/fixtures.ts (createEncounterFixture for encounters).',
    );
  }
}
