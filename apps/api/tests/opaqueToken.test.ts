import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateOpaqueToken, hashOpaqueToken } from '../src/lib/opaqueToken';
import { createTestClinic, type TestClinic } from './helpers';

describe('opaque tokens', () => {
  it('are 256 random bits in base64url', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(token);
  });

  it('hash to 32 deterministic bytes', () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).toHaveLength(32);
    expect(hashOpaqueToken(token).equals(hash)).toBe(true);
    expect(hashOpaqueToken(generateOpaqueToken()).equals(hash)).toBe(false);
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
    const token = generateOpaqueToken();
    const created = await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const found = await prisma.authSession.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
    });
    expect(found?.id).toBe(created.id);

    const other = await prisma.authSession.findUnique({
      where: { tokenHash: hashOpaqueToken(generateOpaqueToken()) },
    });
    expect(other).toBeNull();
  });

  it('rejects a second session with the same hash', async () => {
    const tokenHash = hashOpaqueToken(generateOpaqueToken());
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.authSession.create({ data: { userId: user.id, tokenHash, expiresAt } });

    await expect(
      prisma.authSession.create({ data: { userId: user.id, tokenHash, expiresAt } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
