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
// `app.use('/api/x', [middleware,] xRouter)`; the middleware may have parentheses
// only in `requireRole('ADMIN')`, which the lazy group skips.
const MOUNT = /app\.use\(\s*'([^']*)'\s*,(?:[^;]*?,)?\s*(\w+Router)\s*\)/g;
const IMPORT = /import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g;

type Ruta = { clave: string; origen: string };

function escrituras(codigo: string, origen: string, prefijos: string[]): Ruta[] {
  const rutas: Ruta[] = [];
  for (const [, metodo, ruta] of codigo.matchAll(WRITE_ROUTE)) {
    const relativa = ruta === '/' ? '' : ruta.replace(/\/$/, '');
    for (const prefijo of prefijos) {
      rutas.push({ clave: `${metodo.toUpperCase()} ${prefijo}${relativa}`, origen });
    }
  }
  return rutas;
}

function extraer(): { rutas: Ruta[]; llamadas: number; literales: number; sinMontar: string[] } {
  const app = readFileSync(APP, 'utf8');
  const routerAArchivo = new Map([...app.matchAll(IMPORT)].map(([, v, f]) => [v, `${f}.ts`]));
  const prefijosPorArchivo = new Map<string, string[]>();
  for (const [, prefijo, router] of app.matchAll(MOUNT)) {
    const archivo = routerAArchivo.get(router);
    if (!archivo) continue;
    prefijosPorArchivo.set(archivo, [...(prefijosPorArchivo.get(archivo) ?? []), prefijo]);
  }

  const rutas: Ruta[] = [...escrituras(app, 'app.ts', [''])];
  let llamadas = [...app.matchAll(WRITE_CALL)].length;
  let literales = [...app.matchAll(WRITE_ROUTE)].length;
  const sinMontar: string[] = [];

  for (const archivo of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const codigo = readFileSync(path.join(ROUTES, archivo), 'utf8');
    llamadas += [...codigo.matchAll(WRITE_CALL)].length;
    const cantidad = [...codigo.matchAll(WRITE_ROUTE)].length;
    literales += cantidad;
    if (cantidad > 0 && !prefijosPorArchivo.has(archivo)) sinMontar.push(archivo);
    rutas.push(...escrituras(codigo, `routes/${archivo}`, prefijosPorArchivo.get(archivo) ?? []));
  }
  return { rutas, llamadas, literales, sinMontar };
}

const { rutas, llamadas, literales, sinMontar } = extraer();
const claves = rutas.map((r) => r.clave);
const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
const extraidas = new Set(claves);
const clasificadas = new Set(Object.keys(AUDIT_COVERAGE));

describe('cobertura de audit', () => {
  it('toda llamada de escritura es una ruta con path literal (el regex no quedó ciego)', () => {
    expect(literales, 'llamadas de escritura con path no literal').toBe(llamadas);
  });

  it('ningún archivo de rutas con escrituras queda sin montar en app.ts', () => {
    expect(sinMontar).toEqual([]);
  });

  it('no hay dos rutas con la misma clave', () => {
    expect(repetidas).toEqual([]);
  });

  it('toda ruta que escribe está clasificada en el manifiesto', () => {
    const sinClasificar = [...extraidas].filter((c) => !clasificadas.has(c)).sort();
    expect(sinClasificar, 'escribe y no figura en tests/auditCoverageManifest.ts').toEqual([]);
  });

  it('toda entrada del manifiesto corresponde a una ruta que existe', () => {
    const obsoletas = [...clasificadas].filter((c) => !extraidas.has(c)).sort();
    expect(obsoletas, 'figura en el manifiesto y ya no existe en el código').toEqual([]);
  });

  it('toda exención tiene motivo', () => {
    const sinMotivo = Object.entries(AUDIT_COVERAGE)
      .filter(([, v]) => v.status === 'exempt' && v.reason.trim() === '')
      .map(([k]) => k);
    expect(sinMotivo).toEqual([]);
  });
});
