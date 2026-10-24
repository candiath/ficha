import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { authRepo } from '../src/repositories';
import { authSessionCleanupCutoffs } from '../src/lib/retentionPolicy';
import { createTestClinic, deleteAuditRows, type TestClinic } from './helpers';

// Ended login sessions are deleted 180 days after they ended (#178,
// docs/specs/SPEC-auth-session-cleanup.md). The delete is global and other
// test files run at the same time, so every assertion is about this file's
// own rows, and the batch is large enough never to be the limit.

const DAY = 24 * 60 * 60 * 1000;
const BIG_BATCH = 1_000_000;

describe('deleteEndedAuthSessions', () => {
  let clinic: TestClinic;
  let user: User;
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // A session row with chosen dates. Defaults describe one in use right now.
  async function session(fields: {
    createdAt?: Date;
    expiresAt?: Date;
    revokedAt?: Date | null;
    lastUsedAt?: Date;
    trusted?: boolean;
  }): Promise<string> {
    const { id } = await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: randomBytes(32),
        createdAt: fields.createdAt ?? ago(1),
        expiresAt: fields.expiresAt ?? new Date(now.getTime() + DAY),
        revokedAt: fields.revokedAt ?? null,
        lastUsedAt: fields.lastUsedAt ?? now,
        trusted: fields.trusted ?? false,
      },
      select: { id: true },
    });
    return id;
  }

  const purge = () => authRepo.deleteEndedAuthSessions({ ...authSessionCleanupCutoffs(now), batch: BIG_BATCH });

  const remaining = async (ids: string[]) =>
    (await prisma.authSession.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((s) => s.id);

  it('deletes sessions that ended more than 180 days ago, and nothing that could still be valid', async () => {
    const gone = {
      revoked: await session({ createdAt: ago(190), expiresAt: ago(185), revokedAt: ago(181), lastUsedAt: ago(190) }),
      expired: await session({ createdAt: ago(190), expiresAt: ago(181), lastUsedAt: ago(182) }),
      // Revoked yesterday by a "revoke all" write, long after it expired:
      // it ended at its expiry, not at the revocation.
      expiredThenRevoked: await session({ createdAt: ago(210), expiresAt: ago(200), revokedAt: ago(1), lastUsedAt: ago(205) }),
      idle: await session({ createdAt: ago(200), expiresAt: new Date(now.getTime() + DAY), lastUsedAt: ago(188) }),
    };
    const kept = {
      active: await session({}),
      revokedYesterday: await session({ revokedAt: ago(1) }),
      expired179: await session({ createdAt: ago(185), expiresAt: ago(179), lastUsedAt: ago(180) }),
      trustedIdle6: await session({ trusted: true, createdAt: ago(10), expiresAt: new Date(now.getTime() + 20 * DAY), lastUsedAt: ago(6) }),
      // Ended by idleness 7 days after its last use: 179 days ago.
      idleEnded179: await session({ createdAt: ago(190), expiresAt: new Date(now.getTime() + DAY), lastUsedAt: ago(186) }),
    };

    await purge();

    expect(await remaining(Object.values(gone))).toEqual([]);
    expect((await remaining(Object.values(kept))).sort()).toEqual(Object.values(kept).sort());
  });

  it('leaves an audit row that names a deleted session readable, with its session id', async () => {
    const authSessionId = await session({});
    const patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Retained', lastName: 'Patient' },
      select: { id: true },
    });
    // Written while the session exists, as the insert trigger requires.
    const row = await prisma.auditLog.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        userId: user.id,
        authSessionId,
        entity: 'PATIENT',
        entityId: patient.id,
        action: 'PATIENT_CREATED',
      },
      select: { id: true },
    });
    await prisma.authSession.update({
      where: { id: authSessionId },
      data: { revokedAt: ago(181), expiresAt: ago(181) },
    });

    await purge();

    expect(await remaining([authSessionId])).toEqual([]);
    const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id }, select: { authSessionId: true } });
    expect(after.authSessionId).toBe(authSessionId);
  });

  it('deletes at most one batch per call and reports how many', async () => {
    const ids = [
      await session({ createdAt: ago(200), expiresAt: ago(190), lastUsedAt: ago(195) }),
      await session({ createdAt: ago(200), expiresAt: ago(190), lastUsedAt: ago(195) }),
    ];
    const deleted = await authRepo.deleteEndedAuthSessions({ ...authSessionCleanupCutoffs(now), batch: 1 });

    expect(deleted).toBe(1);
    await purge();
    expect(await remaining(ids)).toEqual([]);
  });
});
