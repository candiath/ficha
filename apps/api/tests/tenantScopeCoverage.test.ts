import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { TENANT_MODELS_FUERA_DEL_GUARD, TENANT_SCOPED_MODELS } from '../src/lib/tenantScope';

// El guard de multi-tenancy es una lista escrita a mano, y el único bug que
// puede tener no falla visiblemente: un modelo con tenantId que nadie agregó a
// la lista compila, pasa los tests de su ruta y devuelve filas de todas las
// clínicas. Este test convierte ese olvido en un CI rojo (issue #74).
//
// Compara el schema real —Prisma.dmmf es schema.prisma ya parseado— contra
// las dos listas de tenantScope.ts: todo modelo con columna tenantId tiene que
// estar scopeado, o declarado fuera del guard con su motivo. Tenant no entra
// en la comparación porque no tiene esa columna: el tenant ES el id.
//
// Sin base de datos: es una comparación de listas.
//
// Prisma.dmmf desaparece del cliente generado a partir de Prisma 6 (#5).
// Cuando llegue ese upgrade, esto pasa a leer prisma/schema.prisma y sacar los
// modelos con una regex sobre `model X {` … `tenantId` — cinco líneas.

const modelosConTenantId = Prisma.dmmf.datamodel.models
  .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
  .map((m) => m.name)
  .sort();

const scopeados: string[] = [...TENANT_SCOPED_MODELS];
const fueraDelGuard = Object.keys(TENANT_MODELS_FUERA_DEL_GUARD);
const clasificados = [...scopeados, ...fueraDelGuard];

describe('cobertura del guard de tenant respecto del schema', () => {
  it('todo modelo con tenantId está scopeado o declarado fuera del guard', () => {
    const sinClasificar = modelosConTenantId.filter((m) => !clasificados.includes(m));

    expect(
      sinClasificar,
      'modelos con tenantId que no figuran en ninguna lista de tenantScope.ts',
    ).toEqual([]);
  });

  it('ninguna de las dos listas nombra un modelo que ya no tenga tenantId', () => {
    // Evita entradas fantasma: Technique se eliminó del schema el 01/09 y una
    // lista que lo siguiera nombrando estaría documentando algo que no existe.
    const fantasmas = clasificados.filter((m) => !modelosConTenantId.includes(m));

    expect(fantasmas, 'entradas de tenantScope.ts sin un modelo con tenantId detrás').toEqual([]);
  });

  it('un modelo no está en las dos listas a la vez', () => {
    const enAmbas = scopeados.filter((m) => fueraDelGuard.includes(m));

    expect(enAmbas).toEqual([]);
  });
});
