import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM } from './jwt';

// Tokens del operador de plataforma. Espejo de jwt.ts con dos diferencias
// que son el punto: otro secreto y otra forma.
//
// Otro secreto: un token de operador firmado con PLATFORM_JWT_SECRET no
// verifica contra JWT_SECRET, así que authenticate lo rechaza por firma
// antes de mirar un solo claim — y al revés. La separación es
// criptográfica, no depende de que algún chequeo de claims esté bien.
//
// Otra forma: `kind: 'platform'` y SIN tenantId. Es la segunda capa, y ya
// existía gratis: verifyAccessToken exige tenantId string, así que aun con
// el mismo secreto un token de operador no pasaría por el de un usuario.

const PLATFORM_TOKEN_KIND = 'platform';

// Más corto que el de la clínica (12h) y sin heredar JWT_EXPIRES_IN: una
// sesión de operador es "entro, hago una cosa, salgo", no una jornada de
// atención. Importa porque los dos tokens viven en el localStorage del mismo
// origen: un XSS en la app clínica podría leer éste, que es el más poderoso
// del sistema, y lo único que acota ese daño es cuánto dura.
const PLATFORM_JWT_EXPIRES_IN = (process.env.PLATFORM_JWT_EXPIRES_IN ??
  '2h') as jwt.SignOptions['expiresIn'];

// Misma exigencia que getJwtSecret, más una: no puede ser el mismo valor.
// Si lo fuera, la separación quedaría reducida a la forma del token, y
// habría que confiar en que ningún chequeo de claims tenga un agujero.
export function getPlatformJwtSecret(): string {
  const secret = process.env.PLATFORM_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'PLATFORM_JWT_SECRET debe estar definido en .env con al menos 32 caracteres. ' +
        'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  if (secret === process.env.JWT_SECRET) {
    throw new Error(
      'PLATFORM_JWT_SECRET no puede ser igual a JWT_SECRET: un token de operador ' +
        'debe ser inválido para la API de la clínica por firma, no solo por forma.',
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
    typeof decoded.sub !== 'string' ||
    typeof decoded.iat !== 'number' ||
    decoded.kind !== PLATFORM_TOKEN_KIND ||
    // Un token con tenantId es de usuario de clínica, venga firmado como venga.
    'tenantId' in decoded
  ) {
    throw new Error('Token con formato inválido');
  }
  return { sub: decoded.sub, iat: decoded.iat };
}
