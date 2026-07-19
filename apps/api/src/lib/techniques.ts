import { prisma } from './prisma';
import type { TenantContext } from '../repositories/types';

// Una técnica es utilizable si pertenece al tenant o es del catálogo global.
// Los ids viajan en el body: sin este chequeo se podría vincular (y mostrar
// el nombre de) una técnica de otra clínica. Compartido por el POST de
// sesiones y el bulkReplace de técnicas.
export async function techniquesBelongToTenant(
  ctx: TenantContext,
  techniqueIds: string[],
): Promise<boolean> {
  if (techniqueIds.length === 0) return true;
  // Deduplicar antes de contar: con ids repetidos el count daría de menos.
  const uniqueIds = [...new Set(techniqueIds)];
  const found = await prisma.technique.count({
    where: {
      id: { in: uniqueIds },
      OR: [{ tenantId: ctx.tenantId }, { tenantId: null }],
    },
  });
  return found === uniqueIds.length;
}
