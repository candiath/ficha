import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlatformJwtSecret, signOperatorToken, verifyOperatorToken } from '../src/lib/platformJwt';
import { generateOpaqueToken } from '../src/lib/opaqueToken';

// Unit tests of the operator token's secret and shape, without a DB.
const ORIGINAL = { ...process.env };

// UUIDs, not toy ids: the verifier requires `sub` to be one (#174), and these
// tests must fail on signature or shape, not on that.
const OP = randomUUID();
const USER = randomUUID();
const TENANT = randomUUID();

afterEach(() => {
  process.env.PLATFORM_JWT_SECRET = ORIGINAL.PLATFORM_JWT_SECRET;
});

describe('getPlatformJwtSecret', () => {
  it('requires at least 32 characters', () => {
    process.env.PLATFORM_JWT_SECRET = 'corto';
    expect(() => getPlatformJwtSecret()).toThrow(/PLATFORM_JWT_SECRET/);

    delete process.env.PLATFORM_JWT_SECRET;
    expect(() => getPlatformJwtSecret()).toThrow(/PLATFORM_JWT_SECRET/);
  });
});

describe('operator token shape', () => {
  it('carries kind=platform and no tenantId', () => {
    const token = signOperatorToken(OP);
    const decoded = verifyOperatorToken(token);
    expect(decoded.sub).toBe(OP);
    expect(typeof decoded.iat).toBe('number');
  });

  it('a clinic session token is not an operator token', () => {
    expect(() => verifyOperatorToken(generateOpaqueToken())).toThrow();
  });

  // Even with the platform's own valid signature, a token shaped like a clinic
  // one (with tenantId, without kind) is rejected by shape.
  it('rejects a clinic-shaped token signed with the platform secret', () => {
    const userShapedWithPlatformSecret = jwt.sign(
      { tenantId: TENANT },
      process.env.PLATFORM_JWT_SECRET as string,
      { subject: USER, expiresIn: '1h' },
    );
    expect(() => verifyOperatorToken(userShapedWithPlatformSecret)).toThrow(/formato/);
  });
});
