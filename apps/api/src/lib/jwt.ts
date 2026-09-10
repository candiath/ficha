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

// Lo que devuelve la verificación: el payload más iat (momento de emisión,
// en segundos Unix; lo agrega jwt.sign automáticamente). El middleware lo
// compara contra passwordChangedAt para invalidar tokens viejos.
export interface VerifiedToken extends TokenPayload {
  iat: number;
}

// Se firma y se verifica con HS256 y nada más. jsonwebtoken 9 ya rechaza
// `alg: none` por su cuenta, y con secreto simétrico no hay clave pública que
// prestarse para una confusión de algoritmos — así que esto no tapa un agujero
// abierto, cierra la familia entera por adelantado. Si algún día se pasa a
// claves asimétricas, no fijar el algoritmo acá es exactamente el bug que
// permite firmar tokens con la clave pública.
const JWT_ALGORITHM = 'HS256' as const;

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign({ tenantId: payload.tenantId }, getJwtSecret(), {
    subject: payload.sub,
    expiresIn: JWT_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  });
}

export function verifyAccessToken(token: string): VerifiedToken {
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.tenantId !== 'string' ||
    typeof decoded.iat !== 'number'
  ) {
    throw new Error('Token con formato inválido');
  }
  return { sub: decoded.sub, tenantId: decoded.tenantId, iat: decoded.iat };
}
