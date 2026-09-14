import { afterEach, describe, expect, it } from 'vitest';
import { getPlatformJwtSecret, signOperatorToken, verifyOperatorToken } from '../src/lib/platformJwt';
import { verifyAccessToken } from '../src/lib/jwt';

// Unit tests del secreto y la forma del token de operador, sin DB.
const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL.JWT_SECRET;
  process.env.PLATFORM_JWT_SECRET = ORIGINAL.PLATFORM_JWT_SECRET;
});

describe('getPlatformJwtSecret', () => {
  it('exige al menos 32 caracteres, como JWT_SECRET', () => {
    process.env.PLATFORM_JWT_SECRET = 'corto';
    expect(() => getPlatformJwtSecret()).toThrow(/PLATFORM_JWT_SECRET/);

    delete process.env.PLATFORM_JWT_SECRET;
    expect(() => getPlatformJwtSecret()).toThrow(/PLATFORM_JWT_SECRET/);
  });

  // Si fueran iguales, la separación entre los dos logins quedaría reducida
  // a la forma del token: un secreto distinto es lo que hace que un token de
  // operador sea inválido para la clínica por firma, antes de mirar claims.
  it('rechaza que sea igual a JWT_SECRET', () => {
    process.env.PLATFORM_JWT_SECRET = process.env.JWT_SECRET;
    expect(() => getPlatformJwtSecret()).toThrow(/igual a JWT_SECRET/);
  });
});

describe('forma del token de operador', () => {
  it('lleva kind=platform y no lleva tenantId', () => {
    const token = signOperatorToken('op-1');
    const decoded = verifyOperatorToken(token);
    expect(decoded.sub).toBe('op-1');
    expect(typeof decoded.iat).toBe('number');
  });

  // Aun con el mismo secreto, la forma ya lo rechazaría: el middleware de la
  // clínica exige tenantId y el de plataforma exige que no lo haya.
  it('el verificador de la clínica lo rechaza, y al revés', () => {
    const operatorToken = signOperatorToken('op-1');
    expect(() => verifyAccessToken(operatorToken)).toThrow();
  });
});
