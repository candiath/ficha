import { Prisma } from '@prisma/client';
import { forTenant } from '../../lib/tenantScope';
import type { TenantContext } from '../types';
import type { TenantUserDTO, UserCreateInput, UserRepository } from '../userRepository';

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

  async setActive(
    ctx: TenantContext,
    id: string,
    isActive: boolean,
  ): Promise<TenantUserDTO | null> {
    const db = forTenant(ctx);
    // updateMany y no update: existencia y pertenencia a la clínica se deciden
    // en la misma query que escribe (patrón de patientRepo.update), así un
    // ADMIN no puede tocar usuarios de otro tenant ni por accidente.
    const { count } = await db.user.updateMany({
      where: { id },
      data: { isActive },
    });
    if (count === 0) return null;

    const row = await db.user.findFirst({ where: { id }, select: tenantUserSelect });
    return row ? toDTO(row) : null;
  },
};
