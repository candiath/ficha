import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashSessionToken } from '../src/lib/sessionToken';
import { createTestClinic, TEST_PASSWORD, type TestClinic } from './helpers';

// Server-side sessions as seen from login (docs/specs/SPEC-server-sessions.md).
// Each login spends rate limiter budget, so this suite logs in sparingly.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('login sessions', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();

    const res = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'session-test-agent/1.0')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    token = res.body.data.token as string;
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('returns an opaque token that authenticates', async () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(user.id);
  });

  it('stores the session with its hash, never the token itself', async () => {
    const sessions = await prisma.authSession.findMany({ where: { userId: user.id } });

    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    expect(session.tokenHash.equals(hashSessionToken(token))).toBe(true);
    // The raw token appears in no column of the row.
    expect(JSON.stringify(session)).not.toContain(token);
  });

  it('records the expiry, IP and user agent of the login', async () => {
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });

    const ttl = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.abs(ttl - SEVEN_DAYS_MS)).toBeLessThan(60_000);
    expect(session.revokedAt).toBeNull();
    expect(session.userAgent).toBe('session-test-agent/1.0');
    expect(session.ip).toBeTruthy();
  });
});
