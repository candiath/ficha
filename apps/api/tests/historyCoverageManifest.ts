// Every repository method that writes a versioned table
// (SPEC-clinical-revisions.md §9), as `file.method`. `versions` means it records
// a revision in the write's transaction; `exempt` carries the reason it need not.
// tests/historyCoverage.test.ts compares this with the source.

export type HistoryCoverage = { kind: 'versions' } | { kind: 'exempt'; reason: string };

const versions: HistoryCoverage = { kind: 'versions' };

export const HISTORY_COVERAGE: Record<string, HistoryCoverage> = {
  'prismaSessionRepository.create': versions,
  'prismaSessionRepository.update': versions,
  'prismaSessionRepository.softDelete': versions,
};
