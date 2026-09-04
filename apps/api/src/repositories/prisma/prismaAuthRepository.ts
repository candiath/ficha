import { prisma } from '../../lib/prisma';
import type {
  AuthRepository,
  AuthUser,
  Credentials,
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
    return prisma.user.findUnique({
      where: { email },
      select: {
        ...publicProfileSelect,
        tenantId: true,
        passwordHash: true,
        isActive: true,
      },
    });
  },

  async findForAuth(userId: string): Promise<AuthUser | null> {
    return prisma.user.findFirst({
      where: { id: userId, isActive: true },
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
};
