import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  TenantDTO,
  TenantRepository,
  TenantUpdateInput,
} from '../tenantRepository';

// ─────────────────────────────────────────────────────────────────────────────
// Excepción documentada al guard de multi-tenancy.
//
// `Tenant` NO está en TENANT_SCOPED_MODELS y no debe estarlo: el guard filtra
// inyectando una columna `tenantId`, y en esta tabla el tenant *es* el `id`.
// Meterla en la lista haría que el guard buscara `tenants.tenant_id`, que no
// existe.
//
// Por eso acá el filtro va a mano, siempre por `ctx.tenantId` y nunca por un
// id que venga del request. Es la misma clase de excepción que authRepository
// (que tampoco recibe ctx), y por las mismas razones vive a la vista en un
// archivo propio en vez de escondida en un helper.
//
// Se usa igual el cliente scopeado en vez del prisma base: sobre un modelo no
// scopeado la extension deja pasar la query intacta, así que no cambia nada en
// runtime, pero mantiene un solo camino de acceso a datos en toda la capa.
// ─────────────────────────────────────────────────────────────────────────────

const tenantSelect = {
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  cuit: true,
  specialty: true,
  timezone: true,
  workdayStart: true,
  workdayEnd: true,
  workdays: true,
} as const;

export const prismaTenantRepository: TenantRepository = {
  async get(ctx: TenantContext): Promise<TenantDTO> {
    const db = forTenant(ctx);
    // OrThrow a propósito: que un usuario autenticado apunte a una clínica
    // inexistente es una FK rota, no un caso de negocio. Un 500 ruidoso es la
    // respuesta correcta; devolver null obligaría a inventar un 404 que
    // mentiría sobre lo que pasó.
    return db.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: tenantSelect,
    });
  },

  async update(ctx: TenantContext, input: TenantUpdateInput): Promise<TenantDTO> {
    const db = forTenant(ctx);
    return db.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.cuit !== undefined && { cuit: input.cuit }),
        ...(input.specialty !== undefined && { specialty: input.specialty }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.workdayStart !== undefined && { workdayStart: input.workdayStart }),
        ...(input.workdayEnd !== undefined && { workdayEnd: input.workdayEnd }),
        ...(input.workdays !== undefined && { workdays: input.workdays }),
      },
      select: tenantSelect,
    });
  },

  async claimAlertsRefresh(ctx: TenantContext, cutoff: Date): Promise<boolean> {
    const db = forTenant(ctx);
    const { count } = await db.tenant.updateMany({
      where: {
        id: ctx.tenantId,
        OR: [{ alertsRefreshedAt: null }, { alertsRefreshedAt: { lt: cutoff } }],
      },
      data: { alertsRefreshedAt: new Date() },
    });
    return count === 1;
  },
};
