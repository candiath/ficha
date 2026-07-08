import jwt from 'jsonwebtoken';

// Payload mínimo: sub (userId) y tenantId. No incluimos email/nombre porque
// el token vive horas y esos datos pueden cambiar; se leen frescos de la DB
// en /api/auth/me o en el middleware.
export interface TokenPayload {
  sub: string;
  tenantId: string;
}

const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? '12h') as jwt.SignOptions['expiresIn'];

// Falla fuerte si el secreto no está configurado: un JWT firmado con un
// secreto vacío o débil equivale a no tener autenticación.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET debe estar definido en .env con al menos 32 caracteres. ' +
        'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }
  return secret;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign({ tenantId: payload.tenantId }, getJwtSecret(), {
    subject: payload.sub,
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.tenantId !== 'string'
  ) {
    throw new Error('Token con formato inválido');
  }
  return { sub: decoded.sub, tenantId: decoded.tenantId };
}
