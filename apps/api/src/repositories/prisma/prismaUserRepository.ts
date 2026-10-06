import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type {
  TenantUserDTO,
  UserCreateInput,
  UserRepository,
  UserUpdateInput,
  UserUpdateResult,
} from '../userRepository';
import { whereConservaAdmin } from './userRules';

const tenantUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
} as const;

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: TenantUserDTO['role'];
  isActive: boolean;
  lastLoginAt: Date | null;
};

function toDTO(row: UserRow): TenantUserDTO {
  return { ...row, lastLoginAt: row.lastLoginAt?.toISOString() ?? null };
}

export const prismaUserRepository: UserRepository = {
  async list(ctx: TenantContext): Promise<TenantUserDTO[]> {
    const db = forTenant(ctx);
    const rows = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: tenantUserSelect,
    });
    return rows.map(toDTO);
  },

  async create(ctx: TenantContext, input: UserCreateInput): Promise<TenantUserDTO | null> {
    const db = forTenant(ctx);
    try {
      const row = await db.user.create({ data: input, select: tenantUserSelect });
      return toDTO(row);
    } catch (err) {
      // P2002 = violación del unique de email. null para que la ruta responda
      // 409; dejarlo pasar sería el 500 opaco del errorHandler.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null;
      }
      throw err;
    }
  },

  async update(ctx: TenantContext, id: string, input: UserUpdateInput): Promise<UserUpdateResult> {
    const db = forTenant(ctx);
    // updateMany y no update: existencia, pertenencia a la clínica y la regla
    // de la última ADMIN se deciden en la misma query que escribe (patrón de
    // patientRepo.update), así un ADMIN no puede tocar usuarios de otro tenant
    // ni dejar a la suya sin nadie, ni por accidente ni por carrera.
    const count = await db.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id, ...whereConservaAdmin(id, input) },
        data: {
          ...(input.role !== undefined && { role: input.role }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });
      // Deactivating closes the user's sessions in the same transaction, so
      // reactivating her later does not bring old sessions back. Only after
      // the scoped write succeeded: that is what proves the user is in this
      // clinic (auth_sessions has no tenantId of its own to scope by).
      if (count > 0 && input.isActive === false) {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return count;
    });

    if (count === 0) {
      // Solo en el camino de error: el where de arriba mezcla "no existe" con
      // "existe pero la regla lo frenó", y la ruta responde distinto a cada uno.
      const existe = await db.user.findFirst({ where: { id }, select: { id: true } });
      return { ok: false, reason: existe ? 'last_admin' : 'not_found' };
    }

    const row = await db.user.findFirstOrThrow({ where: { id }, select: tenantUserSelect });
    return { ok: true, user: toDTO(row) };
  },

  async disconnectDevices(ctx: TenantContext, id: string): Promise<'disconnected' | 'not_found'> {
    const db = forTenant(ctx);
    return db.$transaction(async (tx) => {
      // auth_sessions has no tenantId to scope by: the tenant-scoped lookup
      // in the same transaction is what proves the user is in this clinic,
      // as in deactivation above.
      const user = await tx.user.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!user) return 'not_found';
      await tx.authSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return 'disconnected';
    });
  },
};
