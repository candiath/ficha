import { prisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  LAST_USED_THROTTLE_MS,
  NORMAL_SESSION,
  authSessionProfile,
  TRUSTED_SESSION,
  TRUSTED_SESSIONS_PER_USER,
} from '../../lib/authSessionPolicy';
import { generateOpaqueToken, hashOpaqueToken } from '../../lib/opaqueToken';
import type {
  AuthRepository,
  CreateAuthSessionInput,
  Credentials,
  LoginAttempt,
  LoginEventInput,
  LoginUser,
  PasswordResetTarget,
  PasswordResetUseInput,
  PublicProfile,
  ValidAuthSession,
  AuthSessionSummary,
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

// A password reset link that can still be used (SPEC-password-reset): unused,
// not retired, not expired, and its user and clinic active — a deactivated
// account cannot be reopened through a link generated before. One definition
// for the check and for the write that uses it.
function validPasswordResetWhere(now: Date): Prisma.PasswordResetTokenWhereInput {
  return {
    usedAt: null,
    invalidatedAt: null,
    expiresAt: { gt: now },
    user: { isActive: true, tenant: { deactivatedAt: null } },
  };
}

// A session that still grants access: not revoked, not past its absolute
// timeout, not past its profile's idle timeout. One definition for
// authenticate and for the user's list, so they can never disagree.
function liveAuthSessionWhere(now: Date): Prisma.AuthSessionWhereInput {
  return {
    revokedAt: null,
    expiresAt: { gt: now },
    OR: [
      { trusted: false, lastUsedAt: { gt: new Date(now.getTime() - NORMAL_SESSION.idleMs) } },
      { trusted: true, lastUsedAt: { gt: new Date(now.getTime() - TRUSTED_SESSION.idleMs) } },
    ],
  };
}

// Trusted sessions that still count against the cap.
function liveTrustedAuthSessionWhere(now: Date): Prisma.AuthSessionWhereInput {
  return { ...liveAuthSessionWhere(now), trusted: true };
}

const LIST_LIMIT = 50;

const authSessionSummarySelect = {
  id: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  trusted: true,
  ip: true,
  userAgent: true,
} as const;

function toAuthSessionSummary(row: Prisma.AuthSessionGetPayload<{ select: typeof authSessionSummarySelect }>): AuthSessionSummary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// Demoting moves a trusted session to the normal profile without closing it:
// it keeps working, but under the normal timeouts — its absolute expiry is
// pulled in to at most NORMAL_SESSION.absoluteMs from now (never extended).
async function demoteAuthSessions(tx: Prisma.TransactionClient, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const cap = new Date(Date.now() + NORMAL_SESSION.absoluteMs);
  const [shortened, kept] = await Promise.all([
    tx.authSession.updateMany({
      where: { id: { in: ids }, trusted: true, expiresAt: { gt: cap } },
      data: { trusted: false, expiresAt: cap },
    }),
    tx.authSession.updateMany({
      where: { id: { in: ids }, trusted: true, expiresAt: { lte: cap } },
      data: { trusted: false },
    }),
  ]);
  return shortened.count + kept.count;
}

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

  async createAuthSession(input: CreateAuthSessionInput): Promise<{ token: string }> {
    const token = generateOpaqueToken();
    const data = {
      userId: input.userId,
      tokenHash: hashOpaqueToken(token),
      trusted: input.trusted,
      expiresAt: new Date(Date.now() + authSessionProfile(input.trusted).absoluteMs),
      ip: input.ip,
      userAgent: input.userAgent,
    };

    if (!input.trusted) {
      await prisma.authSession.create({ data });
      return { token };
    }

    // A trusted login enforces the cap in the same transaction: the newest
    // TRUSTED_SESSIONS_PER_USER live trusted sessions stay, older ones are
    // demoted to normal (not closed). Two simultaneous trusted logins can
    // leave one too many until the next one; acceptable.
    await prisma.$transaction(async (tx) => {
      await tx.authSession.create({ data });
      const beyondCap = await tx.authSession.findMany({
        where: { userId: input.userId, ...liveTrustedAuthSessionWhere(new Date()) },
        orderBy: { createdAt: 'desc' },
        skip: TRUSTED_SESSIONS_PER_USER,
        select: { id: true },
      });
      await demoteAuthSessions(
        tx,
        beyondCap.map((s) => s.id),
      );
    });
    return { token };
  },

  async findValidAuthSession(token: string): Promise<ValidAuthSession | null> {
    // The join to users and tenants is the safety net: a deactivated user or
    // clinic is denied here even if some write path forgot to revoke the
    // session. Role and tenant are read fresh, never copied into the session.
    // Idle expiry rides in the same query, with each profile's own timeout.
    const row = await prisma.authSession.findFirst({
      where: {
        ...liveAuthSessionWhere(new Date()),
        tokenHash: hashOpaqueToken(token),
        user: { isActive: true, tenant: { deactivatedAt: null } },
      },
      select: {
        id: true,
        lastUsedAt: true,
        user: { select: { id: true, tenantId: true, role: true } },
      },
    });
    if (!row) return null;
    return {
      authSessionId: row.id,
      userId: row.user.id,
      tenantId: row.user.tenantId,
      role: row.user.role,
      lastUsedAt: row.lastUsedAt,
    };
  },

  async listAuthSessions(userId: string): Promise<AuthSessionSummary[]> {
    const rows = await prisma.authSession.findMany({
      where: { userId, ...liveAuthSessionWhere(new Date()) },
      orderBy: { lastUsedAt: 'desc' },
      take: LIST_LIMIT,
      select: authSessionSummarySelect,
    });
    return rows.map(toAuthSessionSummary);
  },

  async revokeUserAuthSession(userId: string, authSessionId: string): Promise<boolean> {
    const { count } = await prisma.authSession.updateMany({
      where: { id: authSessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  },

  async revokeOtherAuthSessions(userId: string, keepSessionId: string): Promise<number> {
    // Only live sessions: the count must match what her list showed. Expired
    // or idle ones are already dead and stay as they are.
    const { count } = await prisma.authSession.updateMany({
      where: { userId, id: { not: keepSessionId }, ...liveAuthSessionWhere(new Date()) },
      data: { revokedAt: new Date() },
    });
    return count;
  },

  async untrustUserAuthSession(userId: string, authSessionId: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      // Ownership and "is a live trusted session" decided in the lookup; the
      // demotion itself re-checks trusted in its own where.
      const own = await tx.authSession.findFirst({
        where: { id: authSessionId, userId, ...liveTrustedAuthSessionWhere(new Date()) },
        select: { id: true },
      });
      if (!own) return false;
      return (await demoteAuthSessions(tx, [own.id])) > 0;
    });
  },

  async touchAuthSession(authSessionId: string): Promise<void> {
    // Conditioned write: concurrent requests on a stale session all match at
    // most once, and a session touched a moment ago is left alone.
    await prisma.authSession.updateMany({
      where: { id: authSessionId, lastUsedAt: { lt: new Date(Date.now() - LAST_USED_THROTTLE_MS) } },
      data: { lastUsedAt: new Date() },
    });
  },

  async revokeAuthSession(authSessionId: string): Promise<boolean> {
    // The condition rides in the write: revoking twice is a no-op, not an
    // error, and the original revokedAt is kept.
    const { count } = await prisma.authSession.updateMany({
      where: { id: authSessionId, revokedAt: null },
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

  async checkPasswordReset(token: string): Promise<PasswordResetTarget | null> {
    const link = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashOpaqueToken(token), ...validPasswordResetWhere(new Date()) },
      select: { user: { select: { email: true, name: true } } },
    });
    return link?.user ?? null;
  },

  async resetPassword(token: string, input: PasswordResetUseInput): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const link = await tx.passwordResetToken.findFirst({
        where: { tokenHash: hashOpaqueToken(token), ...validPasswordResetWhere(now) },
        select: { id: true, userId: true },
      });
      if (!link) return false;

      // Single use is decided by this write: usedAt: null in its where means
      // that of two concurrent requests with the same link, the second one
      // waits for the first to commit, then matches nothing (count 0).
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: link.id, ...validPasswordResetWhere(now) },
        data: { usedAt: now, usedIp: input.ip, usedUserAgent: input.userAgent },
      });
      if (count === 0) return false;

      await tx.user.update({ where: { id: link.userId }, data: { passwordHash: input.passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: link.userId, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      // Generating the link already revoked every session; this catches any
      // opened since by other means (none should exist: her password was
      // disabled), so the new password starts from a clean slate.
      await tx.authSession.updateMany({
        where: { userId: link.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
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
