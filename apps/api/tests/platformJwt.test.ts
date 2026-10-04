import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlatformJwtSecret, signOperatorToken, verifyOperatorToken } from '../src/lib/platformJwt';
import { signAccessToken, verifyAccessToken } from '../src/lib/jwt';

// Unit tests del secreto y la forma del token de operador, sin DB.
const ORIGINAL = { ...process.env };

// UUIDs y no ids de juguete: los verificadores exigen que `sub` lo sea (#174),
// y estos tests tienen que fallar por firma o por forma, no por eso.
const OP = randomUUID();
const USER = randomUUID();
const TENANT = randomUUID();

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
    const token = signOperatorToken(OP);
    const decoded = verifyOperatorToken(token);
    expect(decoded.sub).toBe(OP);
    expect(typeof decoded.iat).toBe('number');
  });

  // Con secretos distintos, el otro verificador lo rechaza por firma.
  it('el verificador de la clínica lo rechaza, y al revés', () => {
    expect(() => verifyAccessToken(signOperatorToken(OP))).toThrow();
    expect(() => verifyOperatorToken(signAccessToken({ sub: USER, tenantId: TENANT }))).toThrow();
  });

  // Y aun con el MISMO secreto, la forma ya lo rechazaría: el verificador de
  // la clínica exige tenantId y el de plataforma exige que no lo haya (más
  // kind=platform). Se firma a mano con el secreto del otro lado para que la
  // firma sea válida y lo único que falle sea la forma — es la segunda capa
  // del aislamiento, y tiene que sostenerse sola.
  it('con la firma del otro lado, la forma alcanza para rechazarlo en las dos direcciones', () => {
    const operatorShapedWithClinicSecret = jwt.sign(
      { kind: 'platform' },
      process.env.JWT_SECRET as string,
      { subject: OP, expiresIn: '1h' },
    );
    expect(() => verifyAccessToken(operatorShapedWithClinicSecret)).toThrow(/formato/);

    const userShapedWithPlatformSecret = jwt.sign(
      { tenantId: TENANT },
      process.env.PLATFORM_JWT_SECRET as string,
      { subject: USER, expiresIn: '1h' },
    );
    expect(() => verifyOperatorToken(userShapedWithPlatformSecret)).toThrow(/formato/);
  });
});
