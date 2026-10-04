import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateSessionToken, getSessionTtlMs, hashSessionToken } from '../src/lib/sessionToken';
import { createTestClinic, type TestClinic } from './helpers';

describe('session tokens', () => {
  it('are 256 random bits in base64url', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it('hash to 32 deterministic bytes', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(32);
    expect(hashSessionToken(token).equals(hash)).toBe(true);
    expect(hashSessionToken(generateSessionToken()).equals(hash)).toBe(false);
  });
});

describe('getSessionTtlMs', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const original = process.env.SESSION_TTL_DAYS;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_TTL_DAYS;
    else process.env.SESSION_TTL_DAYS = original;
  });

  it('defaults to 7 days when unset or empty', () => {
    delete process.env.SESSION_TTL_DAYS;
    expect(getSessionTtlMs()).toBe(7 * DAY);

    process.env.SESSION_TTL_DAYS = '';
    expect(getSessionTtlMs()).toBe(7 * DAY);
  });

  it('accepts a positive whole number of days', () => {
    process.env.SESSION_TTL_DAYS = '30';
    expect(getSessionTtlMs()).toBe(30 * DAY);
  });

  // Each of these would otherwise reach login: NaN (500 on every login) or a
  // session born expired (login that silently logs out).
  it.each(['7d', 'siete', '0', '-1', '1.5', ' 7'])('rejects "%s"', (value) => {
    process.env.SESSION_TTL_DAYS = value;
    expect(() => getSessionTtlMs()).toThrow(/SESSION_TTL_DAYS/);
  });
});

// Round trip through the bytea column: Prisma maps it to a Buffer, and the
// unique index on token_hash is what authenticate will look sessions up by.
describe('auth_sessions.token_hash', () => {
  let clinic: TestClinic;
  let user: User;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    // Deleting the clinic's users cascades to their sessions.
    await clinic.cleanup();
  });

  it('finds a session by the hash of its token, and only by that', async () => {
    const token = generateSessionToken();
    const created = await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const found = await prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(found?.id).toBe(created.id);

    const other = await prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(generateSessionToken()) },
    });
    expect(other).toBeNull();
  });

  it('rejects a second session with the same hash', async () => {
    const tokenHash = hashSessionToken(generateSessionToken());
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.authSession.create({ data: { userId: user.id, tokenHash, expiresAt } });

    await expect(
      prisma.authSession.create({ data: { userId: user.id, tokenHash, expiresAt } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
