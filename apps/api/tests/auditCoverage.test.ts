import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_COVERAGE } from './auditCoverageManifest';

// Every write route must be classified in AUDIT_COVERAGE: audited (with the
// table its audit row goes to), exempt (with the reason), or debt (with the
// module that closes it). This test reads the source, extracts every write
// route with its full mount path, and compares the two sets. A new route
// without an entry fails; an entry whose route is gone fails.
//
// It is an inventory, not a proof that the row is written: each route's own
// tests check that. See docs/specs/SPEC-audit-coverage.md.
//
// Like idParamCoverage.test.ts, it reads the source instead of the built router:
// Express does not keep the mount path of `app.use('/api/x/:xId', router)`.

const SRC = path.join(__dirname, '..', 'src');
const APP = path.join(SRC, 'app.ts');
const ROUTES = path.join(SRC, 'routes');

const WRITE = '(post|put|patch|delete)';
// Every write call on a router or app, literal path or not. The count of these
// is the ground truth the literal extraction must match.
const WRITE_CALL = new RegExp(`\\b(?:router|app)\\.${WRITE}\\b`, 'g');
// `router.post('/x'`, `router.post<Pick<Params, 'a'>>('/x'`, across lines.
const WRITE_ROUTE = new RegExp(`\\b(?:router|app)\\.${WRITE}\\s*(?:<[^()]*?>)?\\(\\s*'([^']*)'`, 'g');
// `app.use('/api/x', [middleware,] xRouter)`; the lazy group skips middleware
// such as `requireRole('ADMIN')`.
const MOUNT = /app\.use\(\s*'([^']*)'\s*,(?:[^;]*?,)?\s*(\w+Router)\s*\)/g;
const IMPORT = /import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g;

function writeRoutes(source: string, prefixes: string[]): string[] {
  const keys: string[] = [];
  for (const [, method, route] of source.matchAll(WRITE_ROUTE)) {
    const relative = route === '/' ? '' : route.replace(/\/$/, '');
    for (const prefix of prefixes) keys.push(`${method.toUpperCase()} ${prefix}${relative}`);
  }
  return keys;
}

function extract() {
  const app = readFileSync(APP, 'utf8');
  const fileOfRouter = new Map([...app.matchAll(IMPORT)].map(([, name, file]) => [name, `${file}.ts`]));
  const prefixesOfFile = new Map<string, string[]>();
  for (const [, prefix, router] of app.matchAll(MOUNT)) {
    const file = fileOfRouter.get(router);
    if (file) prefixesOfFile.set(file, [...(prefixesOfFile.get(file) ?? []), prefix]);
  }

  const keys = writeRoutes(app, ['']);
  let calls = [...app.matchAll(WRITE_CALL)].length;
  let literals = [...app.matchAll(WRITE_ROUTE)].length;
  const unmounted: string[] = [];

  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(path.join(ROUTES, file), 'utf8');
    const count = [...source.matchAll(WRITE_ROUTE)].length;
    calls += [...source.matchAll(WRITE_CALL)].length;
    literals += count;
    if (count > 0 && !prefixesOfFile.has(file)) unmounted.push(file);
    keys.push(...writeRoutes(source, prefixesOfFile.get(file) ?? []));
  }
  return { keys, calls, literals, unmounted };
}

const { keys, calls, literals, unmounted } = extract();
const extracted = new Set(keys);
const classified = new Set(Object.keys(AUDIT_COVERAGE));

describe('audit coverage', () => {
  it('every write call is a route with a literal path (the regex did not go blind)', () => {
    expect(literals, 'write calls without a literal path').toBe(calls);
  });

  it('every route file with writes is mounted in app.ts', () => {
    expect(unmounted).toEqual([]);
  });

  it('no two routes share a key', () => {
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('every write route is classified in the manifest', () => {
    const missing = [...extracted].filter((k) => !classified.has(k)).sort();
    expect(missing, 'writes and is not in tests/auditCoverageManifest.ts').toEqual([]);
  });

  it('every manifest entry matches a route that exists', () => {
    const stale = [...classified].filter((k) => !extracted.has(k)).sort();
    expect(stale, 'in the manifest but no longer in the code').toEqual([]);
  });

  it('every exemption has a reason', () => {
    const noReason = Object.entries(AUDIT_COVERAGE)
      .filter(([, entry]) => entry.status === 'exempt' && entry.reason.trim() === '')
      .map(([key]) => key);
    expect(noReason).toEqual([]);
  });
});
