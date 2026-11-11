import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { authRepo } from '../src/repositories';
import { createTestClinic, type TestClinic } from './helpers';

// A login compares the password, then creates its session. A write that cuts
// access may land in between: the session is created only if the account is
// still as the comparison saw it (area 2 review, L1). Each case below is the
// state such a write leaves, reached before the session is asked for.
describe('a login does not outlive a revocation that landed after its password check', () => {
  let clinic: TestClinic;

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  const sessionsOf = (userId: string) => prisma.authSession.count({ where: { userId } });
  const ask = (user: User, verifiedPasswordHash: string, trusted = false) =>
    authRepo.createAuthSession({
      userId: user.id,
      tenantId: user.tenantId,
      verifiedPasswordHash,
      trusted,
      ip: null,
      userAgent: null,
    });

  it('creates the session, and records the login, when nothing changed', async () => {
    const user = await clinic.createUser();
    const session = await ask(user, user.passwordHash);

    expect(session?.token).toEqual(expect.any(String));
    expect(await sessionsOf(user.id)).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lastLoginAt).not.toBeNull();
  });

  it('creates none after a password change or a reset link (a new hash)', async () => {
    const user = await clinic.createUser();
    const verified = user.passwordHash;
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash('otra', 4) } });

    expect(await ask(user, verified)).toBeNull();
    expect(await ask(user, verified, true)).toBeNull();
    expect(await sessionsOf(user.id)).toBe(0);
  });

  it('creates none after the user was deactivated', async () => {
    const user = await clinic.createUser();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect(await ask(user, user.passwordHash)).toBeNull();
    expect(await sessionsOf(user.id)).toBe(0);
  });

  it('creates none after the clinic was deactivated', async () => {
    const other = await createTestClinic();
    try {
      const user = await other.createUser();
      await prisma.tenant.update({ where: { id: other.tenantId }, data: { deactivatedAt: new Date() } });

      expect(await ask(user, user.passwordHash)).toBeNull();
      expect(await sessionsOf(user.id)).toBe(0);
    } finally {
      await other.cleanup();
    }
  });
});
