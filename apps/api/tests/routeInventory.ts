import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Every route of the API as `METHOD /full/path`, read from the source like
// auditCoverage.test.ts does: Express does not keep the mount path of
// `app.use('/api/x/:xId', router)`. A router mounted inside another one
// (`router.use('/:id/revisions', revisionRoutes(...))`) is expanded with the
// routes of revisions.ts.

const SRC = path.join(__dirname, '..', 'src');
const APP = path.join(SRC, 'app.ts');
const ROUTES = path.join(SRC, 'routes');

const METHOD = '(get|post|put|patch|delete)';
const CALL = new RegExp(`\\b(?:router|app)\\.${METHOD}\\b`, 'g');
const ROUTE = new RegExp(`\\b(?:router|app)\\.${METHOD}\\s*(?:<[^()]*?>)?\\(\\s*'([^']*)'`, 'g');
const MOUNT = /app\.use\(\s*'([^']*)'\s*,(?:[^;]*?,)?\s*(\w+Router)\s*\)/g;
const IMPORT = /import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g;
const NESTED = /router\.use\(\s*'([^']*)'\s*,\s*revisionRoutes\(/g;

export interface Route {
  method: string;
  path: string;
  key: string;
}

const join = (prefix: string, route: string) => prefix + (route === '/' ? '' : route.replace(/\/$/, ''));

function routesOf(source: string): { method: string; route: string }[] {
  return [...source.matchAll(ROUTE)].map(([, method, route]) => ({ method: method.toUpperCase(), route }));
}

export function routeInventory(): { routes: Route[]; calls: number; literals: number } {
  const app = readFileSync(APP, 'utf8');
  const fileOfRouter = new Map([...app.matchAll(IMPORT)].map(([, name, file]) => [name, `${file}.ts`]));
  const prefixesOfFile = new Map<string, string[]>();
  for (const [, prefix, router] of app.matchAll(MOUNT)) {
    const file = fileOfRouter.get(router);
    if (file) prefixesOfFile.set(file, [...(prefixesOfFile.get(file) ?? []), prefix]);
  }
  const revisions = routesOf(readFileSync(path.join(ROUTES, 'revisions.ts'), 'utf8'));

  const out: { method: string; path: string }[] = routesOf(app).map(({ method, route }) => ({ method, path: route }));
  let calls = [...app.matchAll(CALL)].length;
  let literals = out.length;
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts') && f !== 'revisions.ts')) {
    const source = readFileSync(path.join(ROUTES, file), 'utf8');
    const own = routesOf(source);
    calls += [...source.matchAll(CALL)].length;
    literals += own.length;
    for (const prefix of prefixesOfFile.get(file) ?? []) {
      for (const { method, route } of own) out.push({ method, path: join(prefix, route) });
      for (const [, nested] of source.matchAll(NESTED)) {
        for (const { method, route } of revisions) out.push({ method, path: join(join(prefix, nested), route) });
      }
    }
  }
  return { routes: out.map((r) => ({ ...r, key: `${r.method} ${r.path}` })), calls, literals };
}

/** The path with each `:param` replaced by the value `fill` gives it. */
export function fillPath(route: string, fill: (param: string) => string | undefined): string | null {
  let missing = false;
  const filled = route.replace(/:(\w+)/g, (_m, name: string) => {
    const value = fill(name);
    if (value === undefined) missing = true;
    return value ?? '';
  });
  return missing ? null : filled;
}
