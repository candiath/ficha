import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { OperatorContext } from '../types';
import type { UserUpdateInput, UserUpdateResult } from '../userRepository';
import type {
  OperatorAuth,
  OperatorCredentials,
  OperatorLogin,
  OperatorProfile,
  PlatformAdminCreateInput,
  PlatformAdminCreateResult,
  PlatformAuditLogDTO,
  PlatformRepository,
  PlatformTenantCreateInput,
  PlatformTenantDTO,
  PlatformUserDTO,
} from '../platformRepository';
import { whereConservaAdmin } from './userRules';

// Usa el prisma base a conciencia, como authRepository: no hay TenantContext
// porque el operador no tiene tenant. La contrapartida es que acá el
// tenantId se escribe A MANO en cada where y cada create — es la única capa
// donde eso es correcto, y es exactamente lo que el port declara al pedirlo
// como argumento. Ver el porqué completo en platformRepository.ts.

const operatorProfileSelect = { id: true, email: true, name: true } as const;

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  deactivatedAt: true,
  _count: { select: { users: { where: { role: 'ADMIN', isActive: true } } } },
} satisfies Prisma.TenantSelect;

type TenantRow = Prisma.TenantGetPayload<{ select: typeof tenantSelect }>;

function toTenantDTO(row: TenantRow): PlatformTenantDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    activeAdmins: row._count.users,
  };
}

// La misma proyección que ve una ADMIN de la clínica (prismaUserRepository):
// ni passwordHash ni tenantId, y nada clínico.
const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toUserDTO(row: UserRow): PlatformUserDTO {
  return { ...row, lastLoginAt: row.lastLoginAt?.toISOString() ?? null };
}

const auditSelect = {
  id: true,
  operatorId: true,
  tenantId: true,
  targetUserId: true,
  action: true,
  description: true,
  createdAt: true,
} as const;

type AuditRow = Prisma.PlatformAuditLogGetPayload<{ select: typeof auditSelect }>;

function toAuditDTO(row: AuditRow): PlatformAuditLogDTO {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const prismaPlatformRepository: PlatformRepository = {
  // ─── Operadores ────────────────────────────────────────────────────────────

  async findOperatorByEmailForLogin(email: string): Promise<OperatorLogin | null> {
    return prisma.platformOperator.findUnique({
      where: { email },
      select: { ...operatorProfileSelect, passwordHash: true, isActive: true },
    });
  },

  async findOperatorForAuth(id: string): Promise<OperatorAuth | null> {
    return prisma.platformOperator.findFirst({
      where: { id, isActive: true },
      select: { id: true, passwordChangedAt: true },
    });
  },

  async getOperatorProfile(id: string): Promise<OperatorProfile | null> {
    return prisma.platformOperator.findUnique({ where: { id }, select: operatorProfileSelect });
  },

  async getOperatorCredentials(id: string): Promise<OperatorCredentials | null> {
    return prisma.platformOperator.findUnique({
      where: { id },
      select: { id: true, passwordHash: true },
    });
  },

  async touchOperatorLastLogin(id: string): Promise<void> {
    await prisma.platformOperator.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },

  async updateOperatorPassword(id: string, passwordHash: string): Promise<void> {
    await prisma.platformOperator.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  },

  // ─── Clínicas ──────────────────────────────────────────────────────────────

  async listTenants(): Promise<PlatformTenantDTO[]> {
    const rows = await prisma.tenant.findMany({
      orderBy: { createdAt: 'asc' },
      select: tenantSelect,
    });
    return rows.map(toTenantDTO);
  },

  async createTenant(
    op: OperatorContext,
    input: PlatformTenantCreateInput,
  ): Promise<PlatformTenantDTO | null> {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({ data: input, select: tenantSelect });
        await tx.platformAuditLog.create({
          data: {
            operatorId: op.operatorId,
            tenantId: tenant.id,
            action: 'TENANT_CREATED',
            description: `Creó la clínica "${tenant.name}" (${tenant.slug})`,
          },
        });
        return tenant;
      });
      return toTenantDTO(row);
    } catch (err) {
      // P2002 = slug repetido. null para que la ruta responda 409.
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  },

  async setTenantActive(
    op: OperatorContext,
    tenantId: string,
    active: boolean,
  ): Promise<PlatformTenantDTO | null> {
    return prisma.$transaction(async (tx) => {
      // La condición viaja en el where: solo cambia (y solo audita) si el
      // estado era el contrario. Repetir la acción no duplica la auditoría
      // ni mueve deactivatedAt, que registra la PRIMERA desactivación.
      const { count } = await tx.tenant.updateMany({
        where: { id: tenantId, deactivatedAt: active ? { not: null } : null },
        data: { deactivatedAt: active ? null : new Date() },
      });

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: tenantSelect });
      if (!tenant) return null;

      if (count === 1) {
        await tx.platformAuditLog.create({
          data: {
            operatorId: op.operatorId,
            tenantId,
            action: active ? 'TENANT_REACTIVATED' : 'TENANT_DEACTIVATED',
            description: `${active ? 'Reactivó' : 'Desactivó'} la clínica "${tenant.name}"`,
          },
        });
      }
      return toTenantDTO(tenant);
    });
  },

  // ─── Usuarios de una clínica ───────────────────────────────────────────────

  async listTenantUsers(tenantId: string): Promise<PlatformUserDTO[] | null> {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return null;

    const rows = await prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: userSelect,
    });
    return rows.map(toUserDTO);
  },

  async createAdmin(
    op: OperatorContext,
    tenantId: string,
    input: PlatformAdminCreateInput,
  ): Promise<PlatformAdminCreateResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true },
        });
        if (!tenant) return { ok: false, reason: 'tenant_not_found' } as const;

        // El rol es ADMIN por definición de esta operación: el operador
        // delega la administración, y los THERAPIST los crea la clínica.
        const user = await tx.user.create({
          data: { ...input, tenantId, role: 'ADMIN' },
          select: userSelect,
        });
        await tx.platformAuditLog.create({
          data: {
            operatorId: op.operatorId,
            tenantId,
            targetUserId: user.id,
            action: 'ADMIN_CREATED',
            description: `Creó a ${user.email} como ADMIN de "${tenant.name}"`,
          },
        });
        return { ok: true, user: toUserDTO(user) } as const;
      });
    } catch (err) {
      // P2002 = email ya registrado (unique global, en cualquier clínica).
      if (isUniqueViolation(err)) return { ok: false, reason: 'email_taken' };
      throw err;
    }
  },

  async updateTenantUser(
    op: OperatorContext,
    tenantId: string,
    userId: string,
    input: UserUpdateInput,
  ): Promise<UserUpdateResult> {
    return prisma.$transaction(async (tx) => {
      // tenantId explícito en el where (acá no hay guard) más la misma regla
      // de la última ADMIN que aplica la clínica sobre sí misma: el operador
      // puede nombrar una ADMIN, no dejar a la clínica sin ninguna.
      const { count } = await tx.user.updateMany({
        where: { id: userId, tenantId, ...whereConservaAdmin(userId, input) },
        data: {
          ...(input.role !== undefined && { role: input.role }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });

      if (count === 0) {
        const existe = await tx.user.findFirst({ where: { id: userId, tenantId }, select: { id: true } });
        return { ok: false, reason: existe ? 'last_admin' : 'not_found' } as const;
      }

      const user = await tx.user.findFirstOrThrow({ where: { id: userId, tenantId }, select: userSelect });

      // Una fila por campo tocado: "cambió el rol" y "cambió el estado" son
      // dos hechos distintos aunque lleguen en el mismo PATCH.
      const base = { operatorId: op.operatorId, tenantId, targetUserId: user.id };
      if (input.role !== undefined) {
        await tx.platformAuditLog.create({
          data: {
            ...base,
            action: 'USER_ROLE_CHANGED',
            description: `Cambió el rol de ${user.email} a ${input.role}`,
          },
        });
      }
      if (input.isActive !== undefined) {
        await tx.platformAuditLog.create({
          data: {
            ...base,
            action: 'USER_ACTIVE_CHANGED',
            description: `${input.isActive ? 'Reactivó' : 'Desactivó'} a ${user.email}`,
          },
        });
      }

      return { ok: true, user: toUserDTO(user) } as const;
    });
  },

  // ─── Auditoría ─────────────────────────────────────────────────────────────

  async listAuditLog(tenantId: string): Promise<PlatformAuditLogDTO[]> {
    const rows = await prisma.platformAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: auditSelect,
    });
    return rows.map(toAuditDTO);
  },
};
