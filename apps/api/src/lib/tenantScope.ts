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

// Los nombres son los del modelo Prisma en PascalCase (los que llegan como
// `model` en la extension), no los de la tabla SQL.
//
const TENANT_SCOPED_MODELS = new Set<string>([
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
  'FunctionalScale'
]);

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

export function forTenant(ctx: TenantContext) {
  const { tenantId } = ctx;
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && TENANT_SCOPED_MODELS.has(model)) {
            return query(scopeArgs(operation, args as Record<string, unknown>, tenantId));
          }
          return query(args);
        },
      },
    },
  });
}

// Cliente scopeado: el tipo que verán los handlers en req.db.
export type TenantScopedClient = ReturnType<typeof forTenant>;
