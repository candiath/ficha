import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HISTORY_COVERAGE } from './historyCoverageManifest';

// Every repository method that writes a versioned table is in HISTORY_COVERAGE.
// This reads the source: a new write method fails until someone declares it, an
// entry whose method stopped writing fails, and one declared `versions` has to
// call recordRevision. That it does so correctly is what the invariant
// (tests/revisionInvariant.ts) checks at runtime.

const REPOSITORIES = path.join(__dirname, '..', 'src', 'repositories', 'prisma');

const VERB = '(?:create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)';
const WRITES = [
  // A delegate call: tx.session.update(…), db.sessionEpisode.deleteMany(…).
  new RegExp(`\\.(?:session|sessionEpisode)\\s*\\.\\s*${VERB}\\b`),
  // A nested write through a relation: sessions: { update: … }, episodes: { create: … }.
  new RegExp(`\\b(?:sessions?|episodes):\\s*\\{\\s*${VERB}\\b`),
  // Raw SQL.
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(?:sessions|session_episodes)\b/i,
];

// A method of the repository object, or a function of the file.
const METHOD_START = /^(?: {2}(?:async )?(\w+)\(|(?:export )?(?:async )?function (\w+)\b)/gm;

interface Method {
  key: string;
  source: string;
}

export function methodsOf(file: string, source: string): Method[] {
  const starts = [...source.matchAll(METHOD_START)];
  return starts.map((match, i) => ({
    key: `${file}.${match[1] ?? match[2]}`,
    source: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

const writes = (source: string) => WRITES.some((pattern) => pattern.test(source));

const methods = readdirSync(REPOSITORIES)
  .filter((name) => name.endsWith('.ts'))
  .flatMap((name) => methodsOf(path.basename(name, '.ts'), readFileSync(path.join(REPOSITORIES, name), 'utf8')));

describe('history coverage', () => {
  const writers = methods.filter((m) => writes(m.source));

  it('classifies every repository method that writes a versioned table, and nothing else', () => {
    expect(writers.map((m) => m.key).sort()).toEqual(Object.keys(HISTORY_COVERAGE).sort());
  });

  it('finds a revision in every method that says it versions', () => {
    const missing = writers
      .filter((m) => HISTORY_COVERAGE[m.key]?.kind === 'versions' && !m.source.includes('recordRevision('))
      .map((m) => m.key);
    expect(missing).toEqual([]);
  });

  it('gives a reason for every exemption', () => {
    for (const entry of Object.values(HISTORY_COVERAGE)) {
      if (entry.kind === 'exempt') expect(entry.reason).not.toBe('');
    }
  });

  it('would notice a new write method', () => {
    const source = `export const repo = {
  async read(ctx) {
    return db.session.findMany();
  },
  async sneak(ctx) {
    await tx.sessionEpisode.deleteMany({ where });
  },
  async nested(ctx) {
    await tx.patient.update({ data: { sessions: { update: {} } } });
  },
  async raw(ctx) {
    await tx.$executeRaw\`UPDATE sessions SET observations = null\`;
  },
};`;
    expect(methodsOf('repo', source).filter((m) => writes(m.source)).map((m) => m.key)).toEqual([
      'repo.sneak',
      'repo.nested',
      'repo.raw',
    ]);
  });
});
