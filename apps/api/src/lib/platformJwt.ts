import jwt from 'jsonwebtoken';
import { isId } from './validation';

// Platform operator tokens. The operator is the last JWT in the system: the
// clinic moved to opaque server-side sessions (auth_sessions), and the
// operator follows in its own module (docs/specs/auth-redesign-map.md,
// operator-sessions).
//
// The two never overlap: a clinic session token is 43 random characters that
// name a row in auth_sessions, not a JWT, so it fails verification here; and
// an operator JWT matches no session hash, so authenticate rejects it.
//
// Shape: `kind: 'platform'` and NO tenantId. A token carrying tenantId is a
// clinic token by definition, whatever signed it.

const PLATFORM_TOKEN_KIND = 'platform';

// Signed and verified with HS256 only. jsonwebtoken 9 already rejects
// `alg: none`, and with a symmetric secret there is no public key to lend
// itself to algorithm confusion — so this closes the whole family in advance
// rather than plugging an open hole. If this ever moves to asymmetric keys,
// leaving the algorithm unpinned is exactly the bug that lets someone sign
// tokens with the public key.
const JWT_ALGORITHM = 'HS256' as const;

// Short on purpose: an operator session is "log in, do one thing, leave",
// not a working day. It matters because both tokens live in the same origin's
// localStorage: an XSS in the clinic app could read this one, the most
// powerful in the system, and while it cannot be revoked one by one, its
// lifetime is the only thing that bounds the damage.
const PLATFORM_JWT_EXPIRES_IN = (process.env.PLATFORM_JWT_EXPIRES_IN ??
  '2h') as jwt.SignOptions['expiresIn'];

// Fails loudly if the secret is missing or short: a JWT signed with an empty
// or weak secret is the same as no authentication.
export function getPlatformJwtSecret(): string {
  const secret = process.env.PLATFORM_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'PLATFORM_JWT_SECRET debe estar definido en .env con al menos 32 caracteres. ' +
        'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  return secret;
}

export interface VerifiedOperatorToken {
  sub: string;
  iat: number;
}

export function signOperatorToken(operatorId: string): string {
  return jwt.sign({ kind: PLATFORM_TOKEN_KIND }, getPlatformJwtSecret(), {
    subject: operatorId,
    expiresIn: PLATFORM_JWT_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyOperatorToken(token: string): VerifiedOperatorToken {
  const decoded = jwt.verify(token, getPlatformJwtSecret(), { algorithms: [JWT_ALGORITHM] });
  if (
    typeof decoded === 'string' ||
    // UUID, como en verifyAccessToken: va directo a una columna uuid.
    !isId(decoded.sub) ||
    typeof decoded.iat !== 'number' ||
    decoded.kind !== PLATFORM_TOKEN_KIND ||
    // Un token con tenantId es de usuario de clínica, venga firmado como venga.
    'tenantId' in decoded
  ) {
    throw new Error('Token con formato inválido');
  }
  return { sub: decoded.sub, iat: decoded.iat };
}
