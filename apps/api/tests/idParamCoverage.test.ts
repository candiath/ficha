import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Todo parámetro de ruta (`:id`, `:patientId`…) es un id, y las columnas de ids
// son `uuid` nativo (issue #174): uno que llegue al repositorio sin validar y
// con otra forma hace tirar P2023. El errorHandler lo ataja como 404, pero eso
// es la red, no la regla — la regla es `router.param(nombre, idParam(...))`.
//
// Olvidarse de registrarlo para un param nuevo no falla en ningún test de la
// ruta (con un id válido todo anda), así que este test lo convierte en CI rojo.
//
// Lee el código y no el router armado: Express no guarda el path original de
// un `app.use('/api/patients/:patientId/...')`, así que desde el objeto no se
// puede saber qué params declara. Y la regla es por archivo, igual que la de
// Express: un `router.param` solo se dispara para los params de su router, y
// los del path de montaje necesitan `app.param` en app.ts.

const SRC = path.join(__dirname, '..', 'src');
const archivos = [
  path.join(SRC, 'app.ts'),
  ...readdirSync(path.join(SRC, 'routes'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(SRC, 'routes', f)),
];

// `router.get<Params>('/:id', …)`, `app.use('/api/x/:xId', …)`, etc.
const RUTA = /\.(?:get|post|put|patch|delete|all|use)\b[^(]*\(\s*'([^']*)'/g;
const REGISTRO = /\.param\(\s*'(\w+)'/g;

function params(codigo: string): Set<string> {
  const usados = new Set<string>();
  for (const [, ruta] of codigo.matchAll(RUTA)) {
    for (const [, nombre] of ruta.matchAll(/:(\w+)/g)) usados.add(nombre);
  }
  return usados;
}

function registrados(codigo: string): Set<string> {
  return new Set([...codigo.matchAll(REGISTRO)].map(([, nombre]) => nombre));
}

describe('cobertura de idParam', () => {
  it('hay rutas con params para revisar (el regex no quedó ciego)', () => {
    const total = archivos.reduce((n, f) => n + params(readFileSync(f, 'utf8')).size, 0);
    expect(total).toBeGreaterThan(5);
  });

  it.each(archivos.map((f) => [path.relative(SRC, f), f]))(
    '%s: todo :param de sus rutas tiene su .param()',
    (_nombre, archivo) => {
      const codigo = readFileSync(archivo, 'utf8');
      const faltan = [...params(codigo)].filter((p) => !registrados(codigo).has(p));
      expect(faltan, 'params sin validación de formato registrada en este archivo').toEqual([]);
    },
  );

  it.each(archivos.map((f) => [path.relative(SRC, f), f]))(
    '%s: no registra params que ninguna de sus rutas usa',
    (_nombre, archivo) => {
      const codigo = readFileSync(archivo, 'utf8');
      const sobran = [...registrados(codigo)].filter((p) => !params(codigo).has(p));
      expect(sobran, 'un .param() acá no se dispara nunca').toEqual([]);
    },
  );
});
