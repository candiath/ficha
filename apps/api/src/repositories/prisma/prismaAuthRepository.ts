import { prisma } from '../../lib/prisma';
import type {
  AuthRepository,
  AuthUser,
  Credentials,
  LoginAttempt,
  LoginEventInput,
  LoginUser,
  PublicProfile,
} from '../authRepository';

// Usa el prisma base a conciencia: estas queries corren ANTES de que exista
// un TenantContext (son las que lo construyen), así que no hay tenant por el
// cual scopear. Todo se busca por claves únicas globales (email, id del
// propio token): nunca por campos que un request pueda ampliar a otro tenant.

// La clínica viaja anidada en el perfil: es una sola query en vez de dos, y
// la comparten /me y el login (los dos devuelven el mismo AuthUser).
const publicProfileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  tenant: { select: { name: true, slug: true } },
} as const;

export const prismaAuthRepository: AuthRepository = {
  async findByEmailForLogin(email: string): Promise<LoginUser | null> {
    const row = await prisma.user.findUnique({
      where: { email },
      select: {
        ...publicProfileSelect,
        tenant: { select: { name: true, slug: true, deactivatedAt: true } },
        tenantId: true,
        passwordHash: true,
        isActive: true,
      },
    });
    if (!row) return null;
    // deactivatedAt no sale del repositorio: el cliente recibe la identidad
    // de la clínica (name, slug) y la ruta solo necesita el booleano.
    const { tenant, ...user } = row;
    return {
      ...user,
      tenant: { name: tenant.name, slug: tenant.slug },
      tenantActive: tenant.deactivatedAt === null,
    };
  },

  async findForAuth(userId: string): Promise<AuthUser | null> {
    // La clínica desactivada revoca a todos sus usuarios de golpe, en el
    // request siguiente: es la misma mecánica que isActive, un nivel arriba.
    return prisma.user.findFirst({
      where: { id: userId, isActive: true, tenant: { deactivatedAt: null } },
      select: { id: true, tenantId: true, role: true, passwordChangedAt: true },
    });
  },

  async getPublicProfile(userId: string): Promise<PublicProfile | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: publicProfileSelect,
    });
  },

  async getCredentials(userId: string): Promise<Credentials | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, passwordHash: true },
    });
  },

  async touchLastLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  },

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    // passwordChangedAt invalida los tokens emitidos antes del cambio:
    // authenticate compara el iat del token contra esta marca.
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
  },

  async recordLoginEvent(input: LoginEventInput): Promise<void> {
    await prisma.loginEvent.create({ data: input });
  },

  async recentLoginAttempts(email: string, since: Date, limit: number): Promise<LoginAttempt[]> {
    return prisma.loginEvent.findMany({
      where: { email, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { success: true },
    });
  },
};
