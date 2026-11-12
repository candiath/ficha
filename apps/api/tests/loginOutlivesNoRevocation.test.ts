import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { authRepo } from '../src/repositories';
import { createTestClinic, sleep, TEST_PASSWORD, waitFor, type TestClinic } from './helpers';

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

// The same, with the cut in flight rather than committed: the login waits for
// it on the rows it locks, then creates nothing.
describe('a login waits for a cut in flight, then creates nothing', () => {
  let clinic: TestClinic;

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('a clinic deactivation committing while the login waits on its row', async () => {
    const user = await clinic.createUser();
    let commit!: () => void;
    const held = new Promise<void>((r) => (commit = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const deactivation = prisma.$transaction(
      async (tx) => {
        await tx.tenant.update({ where: { id: clinic.tenantId }, data: { deactivatedAt: new Date() } });
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    const login = authRepo.createAuthSession({
      userId: user.id,
      tenantId: user.tenantId,
      verifiedPasswordHash: user.passwordHash,
      trusted: false,
      ip: null,
      userAgent: null,
    });
    await sleep(200); // the login is now waiting on the clinic's row
    commit();
    await deactivation;

    expect(await login).toBeNull();
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
    await prisma.tenant.update({ where: { id: clinic.tenantId }, data: { deactivatedAt: null } });
  });

  it('a new password committing while the login waits on her row', async () => {
    const user = await clinic.createUser();
    let commit!: () => void;
    const held = new Promise<void>((r) => (commit = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const change = prisma.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash('otra', 4) } });
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await isLocked;

    const login = authRepo.createAuthSession({
      userId: user.id,
      tenantId: user.tenantId,
      verifiedPasswordHash: user.passwordHash,
      trusted: true,
      ip: null,
      userAgent: null,
    });
    await sleep(200);
    commit();
    await change;

    expect(await login).toBeNull();
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('the login route, when the account changed after its password check', () => {
  let clinic: TestClinic;

  beforeAll(async () => {
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await clinic.cleanup();
  });

  it('answers the same 401 as any failed login, and records a failure', async () => {
    const user = await clinic.createUser();
    vi.spyOn(authRepo, 'createAuthSession').mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.8.0.1')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
    await waitFor(() => prisma.loginEvent.findFirst({ where: { email: user.email, success: false } }));
    expect(await prisma.loginEvent.count({ where: { email: user.email, success: true } })).toBe(0);
  });
});
