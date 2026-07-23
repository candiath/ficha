import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import type { TenantContext } from '../repositories/types';

// Guardia estructural de multi-tenancy (B1).
//
// `forTenant(ctx)` devuelve un cliente Prisma "scopeado": una client extension
// intercepta TODA operación sobre los modelos de dominio e inyecta sola el
// tenantId (en `where` para lecturas/updates/deletes, en `data` para creates).
// Así los handlers nunca escriben `tenantId` a mano y no pueden olvidárselo.
//
// Límite conocido: la extension solo ve el nivel top de cada query. Los
// creates/reads ANIDADOS sobre relaciones (p. ej. `patient: { select }` dentro
// de un findMany de payments) NO se filtran acá; esos casos se resuelven por
// ruta. Por eso B8 (pacientes borrados en reads anidados) es un paso aparte.

// Única fuente de verdad de los modelos scopeados, en PascalCase (los nombres
// que llegan como `model` en la extension), no los de la tabla SQL. De esta
// tupla se derivan tanto el Set de runtime como el tipo ScopedModelName (abajo):
// agregar un modelo es una sola línea acá.
const TENANT_SCOPED_MODELS = [
  'User',
  'Patient',
  'ClinicalEpisode',
  'InitialEvaluation',
  'Session',
  'SessionPackage',
  'Payment',
  'InformedConsent',
  'AuditLog',
  'ClinicalAlert',
  'FunctionalScale',
] as const;

// Set para el chequeo de runtime en la extension (.has(model)).
const TENANT_SCOPED_MODEL_SET = new Set<string>(TENANT_SCOPED_MODELS);

// Operaciones cuyo `where` acota las filas afectadas: se les inyecta tenantId.
// En Prisma 5 el WhereUniqueInput acepta campos no-únicos, así que esto vale
// también para findUnique/update/delete por id (no solo los *Many).
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

// Inyecta el tenantId en los args según la operación. Se sobrescribe cualquier
// tenantId que ya venga en el where/data: el del contexto es la fuente de
// verdad, y así un id espurio en el body no puede apuntar a otro tenant.
function scopeArgs(
  operation: string,
  args: Record<string, unknown> | undefined,
  tenantId: string,
): Record<string, unknown> {
  const next = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation)) {
    next.where = { ...(next.where as object), tenantId };
  } else if (operation === 'create') {
    next.data = { ...(next.data as object), tenantId };
  } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const rows = next.data;
    next.data = Array.isArray(rows)
      ? rows.map((row) => ({ ...(row as object), tenantId }))
      : { ...(rows as object), tenantId };
  } else if (operation === 'upsert') {
    next.where = { ...(next.where as object), tenantId };
    next.create = { ...(next.create as object), tenantId };
  }

  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos: el cliente scopeado que ven los handlers en req.db.
//
// En runtime la extension inyecta el tenantId, pero $extends NO cambia los
// tipos de entrada: el `create` de un modelo scopeado seguiría exigiendo
// tenantId (es un campo requerido). Reconstruimos el tipo a mano para que los
// modelos scopeados acepten `create`/`createMany` SIN tenantId y, además, lo
// PROHÍBAN (tenantId lo pone el guard; pasarlo a mano no tiene sentido).
// ─────────────────────────────────────────────────────────────────────────────

// Nombres de delegate (camelCase) de los modelos scopeados, DERIVADOS de la
// tupla TENANT_SCOPED_MODELS (PascalCase) — una sola fuente de verdad.
//
// Uncapitalize pasa cada nombre de modelo a su clave de delegate: Prisma nombra
// los delegate con la primera letra en minúscula (ClinicalEpisode ->
// clinicalEpisode), que es exactamente lo que hace Uncapitalize.
//
// Guarda de typos gratis: el mapeo de TenantScopedClient (abajo) indexa
// PrismaClient[K] con estos nombres, así que un nombre de la tupla que no sea un
// modelo real de Prisma hace fallar la compilación ahí (TS2536). Verificado.
type ScopedModelName = Uncapitalize<(typeof TENANT_SCOPED_MODELS)[number]>;

// Quita tenantId (y la relation tenant) de un input de create y además los
// PROHÍBE con `?: never`: quitar la prop no alcanza porque el método es
// genérico y la inferencia deja pasar propiedades de más; el `never` hace que
// pasar tenantId sea un error de tipo. Distribuye sobre la unión
// XOR<CreateInput, UncheckedCreateInput> que Prisma usa para `data`.
type WithoutTenant<T> = T extends unknown
  ? Omit<T, 'tenantId' | 'tenant'> & { tenantId?: never; tenant?: never }
  : never;

// Args de create con el `data` sin tenantId (soporta el data-array de createMany).
type ScopedArgs<A> = A extends { data: infer D }
  ? Omit<A, 'data'> & {
      data: D extends readonly unknown[] ? WithoutTenant<D[number]>[] : WithoutTenant<D>;
    }
  : A;

// Un delegate de modelo con create/createMany/createManyAndReturn reescritos
// para omitir tenantId; el resto de las operaciones queda igual.
type ScopedDelegate<D> = Omit<D, 'create' | 'createMany' | 'createManyAndReturn'> & {
  create<A extends ScopedArgs<Prisma.Args<D, 'create'>>>(
    args: A,
  ): Prisma.PrismaPromise<Prisma.Result<D, A, 'create'>>;
  createMany<A extends ScopedArgs<Prisma.Args<D, 'createMany'>>>(
    args: A,
  ): Prisma.PrismaPromise<Prisma.Result<D, A, 'createMany'>>;
  createManyAndReturn<A extends ScopedArgs<Prisma.Args<D, 'createManyAndReturn'>>>(
    args: A,
  ): Prisma.PrismaPromise<Prisma.Result<D, A, 'createManyAndReturn'>>;
};

// Cliente scopeado: los modelos de dominio con create sin tenantId; el resto
// del cliente ($transaction, $queryRaw, modelos globales) intacto.
export type TenantScopedClient = Omit<PrismaClient, ScopedModelName> & {
  [K in ScopedModelName]: ScopedDelegate<PrismaClient[K]>;
};

export function forTenant(ctx: TenantContext): TenantScopedClient {
  const { tenantId } = ctx;
  const scoped = prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && TENANT_SCOPED_MODEL_SET.has(model)) {
            return query(scopeArgs(operation, args, tenantId));
          }
          return query(args);
        },
      },
    },
  });
  // El cliente extendido es equivalente en runtime; solo reetiquetamos los
  // tipos de entrada de create (ver bloque de tipos arriba).
  return scoped as unknown as TenantScopedClient;
}
