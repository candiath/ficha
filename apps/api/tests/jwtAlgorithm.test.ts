import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestOperator, type TestOperator } from './helpers';

// The operator token is pinned to HS256, when signing and when verifying.
//
// It does not plug an open hole today: jsonwebtoken 9 already rejects
// `alg: none`, and with a symmetric secret there is no public key to lend
// itself to algorithm confusion. It closes the whole family in advance — the
// day this moves to asymmetric keys, an unpinned algorithm is exactly the bug
// that lets someone sign tokens with the public key.
//
// These tests keep the pin from being dropped unnoticed: removing it breaks
// no normal flow. (Clinic tokens are opaque sessions, not JWTs: no algorithm
// to pin there.)
describe('the operator token is only accepted signed with HS256', () => {
  let op: TestOperator;
  const TENANTS = '/api/platform/tenants';

  beforeAll(async () => {
    op = await createTestOperator();
  });

  afterAll(async () => {
    await op.cleanup();
  });

  it('accepts the normal token', async () => {
    const res = await request(app).get(TENANTS).set('Authorization', `Bearer ${op.token}`);

    expect(res.status).toBe(200);
  });

  // The case the pin really targets: same secret, another algorithm. Without
  // `algorithms: ['HS256']` on verification, jsonwebtoken would accept it.
  it('rejects an HS512 token signed with the same secret', async () => {
    const token = jwt.sign({ kind: 'platform' }, process.env.PLATFORM_JWT_SECRET as string, {
      subject: op.operator.id,
      expiresIn: '1h',
      algorithm: 'HS512',
    });

    const res = await request(app).get(TENANTS).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('rejects an unsigned token (alg: none)', async () => {
    const token = jwt.sign({ kind: 'platform' }, '', {
      subject: op.operator.id,
      expiresIn: '1h',
      algorithm: 'none',
    });

    const res = await request(app).get(TENANTS).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
