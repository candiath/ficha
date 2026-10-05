import { prisma } from '../../lib/prisma';
import {
  LAST_USED_THROTTLE_MS,
  NORMAL_SESSION,
  sessionProfile,
  TRUSTED_SESSION,
} from '../../lib/sessionPolicy';
import { generateSessionToken, hashSessionToken } from '../../lib/sessionToken';
import type {
  AuthRepository,
  CreateSessionInput,
  Credentials,
  LoginAttempt,
  LoginEventInput,
  LoginUser,
  PublicProfile,
  SessionAuth,
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

  async createSession(input: CreateSessionInput): Promise<{ token: string }> {
    const token = generateSessionToken();
    await prisma.authSession.create({
      data: {
        userId: input.userId,
        tokenHash: hashSessionToken(token),
        trusted: input.trusted,
        expiresAt: new Date(Date.now() + sessionProfile(input.trusted).absoluteMs),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
    return { token };
  },

  async findSessionForAuth(token: string): Promise<SessionAuth | null> {
    // The join to users and tenants is the safety net: a deactivated user or
    // clinic is denied here even if some write path forgot to revoke the
    // session. Role and tenant are read fresh, never copied into the session.
    // Idle expiry rides in the same query, with each profile's own timeout.
    const now = Date.now();
    const row = await prisma.authSession.findFirst({
      where: {
        tokenHash: hashSessionToken(token),
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
        user: { isActive: true, tenant: { deactivatedAt: null } },
        OR: [
          { trusted: false, lastUsedAt: { gt: new Date(now - NORMAL_SESSION.idleMs) } },
          { trusted: true, lastUsedAt: { gt: new Date(now - TRUSTED_SESSION.idleMs) } },
        ],
      },
      select: {
        id: true,
        lastUsedAt: true,
        user: { select: { id: true, tenantId: true, role: true } },
      },
    });
    if (!row) return null;
    return {
      sessionId: row.id,
      userId: row.user.id,
      tenantId: row.user.tenantId,
      role: row.user.role,
      lastUsedAt: row.lastUsedAt,
    };
  },

  async touchSession(sessionId: string): Promise<void> {
    // Conditioned write: concurrent requests on a stale session all match at
    // most once, and a session touched a moment ago is left alone.
    await prisma.authSession.updateMany({
      where: { id: sessionId, lastUsedAt: { lt: new Date(Date.now() - LAST_USED_THROTTLE_MS) } },
      data: { lastUsedAt: new Date() },
    });
  },

  async revokeSession(sessionId: string): Promise<boolean> {
    // The condition rides in the write: revoking twice is a no-op, not an
    // error, and the original revokedAt is kept.
    const { count } = await prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
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

  async changePassword(userId: string, passwordHash: string, keepSessionId: string): Promise<void> {
    // Changing the password is the panic button against a stolen session:
    // every other session dies with the old password. Same transaction, so a
    // failure cannot leave the new password in place with old sessions alive.
    // password_changed_at is no longer written; its DROP comes in a later
    // release (destructive migrations take two).
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      prisma.authSession.updateMany({
        where: { userId, id: { not: keepSessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
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
